/**
 * Phase: routes
 *
 * Builds the route registry (Next.js, Expo, PHP, Laravel, decorator-based)
 * and creates Route graph nodes + HANDLES_ROUTE edges.
 * Also links middleware, processes fetch() calls, and scans HTML templates.
 *
 * @deps    parse
 * @reads   allPaths, allExtractedRoutes, allDecoratorRoutes, allFetchCalls
 * @writes  graph (Route nodes, HANDLES_ROUTE, FETCHES_FROM edges)
 * @output  routeRegistry, handlerContents
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import type { ParseOutput } from './parse.js';
import { isBladeTemplateFilename } from 'gitnexus-shared';
import { nextjsFileToRouteURL, normalizeFetchURL } from '../route-extractors/nextjs.js';
import { expoFileToRouteURL } from '../route-extractors/expo.js';
import { phpFileToRouteURL } from '../route-extractors/php.js';
import {
  extractResponseShapes,
  extractPHPResponseShapes,
} from '../route-extractors/response-shapes.js';
import {
  extractMiddlewareChain,
  extractNextjsMiddlewareConfig,
  compileMatcher,
  compiledMatcherMatchesRoute,
} from '../route-extractors/middleware.js';
import { processNextjsFetchRoutes } from '../call-processor.js';
import { generateId } from '../../../lib/utils.js';
import { readFileContents } from '../filesystem-walker.js';
import { isDev } from '../utils/env.js';

import { logger } from '../../logger.js';
const EXPO_NAV_PATTERNS = [
  /router\.(push|replace|navigate)\(\s*['"`]([^'"`]+)['"`]/g,
  /<Link\s+[^>]*href=\s*['"`]([^'"`]+)['"`]/g,
];

const HARMONY_ROUTER_NAME_FILE_RE = /(^|\/)RouterName\.ets$/;
const HARMONY_ROUTER_NAME_RE = /\bstatic\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`]+)['"`]/g;
const HARMONY_UI_DECL_RE =
  /((?:\s*@[\w$]+(?:\s*\([\s\S]*?\))?\s*)+)\s*(?:export\s+)?(?:default\s+)?(?:struct|class)\s+([A-Za-z_$][\w$]*)/g;
const HARMONY_DECORATOR_RE = /@([A-Za-z_$][\w$]*)/g;
const HARMONY_COMPONENT_DECORATORS = new Set(['Component', 'ComponentV2', 'CustomDialog']);
const HARMONY_CALL_NAME_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const HARMONY_CLASS_REF_RE =
  /\b(?:new\s+|:\s*|as\s+|extends\s+|implements\s+)([A-Z][A-Za-z_$][\w$]*)\b/g;
const HARMONY_IMPORT_RE =
  /import\s+(?:type\s+)?(?:(\{[^}]*\})|([A-Za-z_$][\w$]*)(?:\s*,\s*(\{[^}]*\}))?)\s+from\s+['"]([^'"]+)['"]/g;
const HARMONY_APP_STORAGE_CALL_RE =
  /\bAppStorage\.(get|set|setOrCreate|link|prop|setAndLink|setAndProp|delete|has)\s*(?:<[^>]*>)?\s*\(\s*([^,\)\n]+)/g;
const HARMONY_STORAGE_DECORATOR_RE = /@(StorageLink|StorageProp)\s*\(\s*([^)]+)\)/g;

interface HarmonyImportRef {
  importedName: string | null;
  filePath: string | null;
}

interface HarmonyDeclaration {
  id: string;
  name: string;
  filePath: string;
  body: string;
  isEntry: boolean;
  isRouteComponent: boolean;
  isComponent: boolean;
  bodyStartLine: number;
}

interface HarmonyComponentResolution {
  component: HarmonyDeclaration;
  reason: string;
}

interface HarmonyClassRef {
  id: string;
  name: string;
  filePath: string;
}

interface HarmonyClassResolution {
  classNode: HarmonyClassRef;
  reason: string;
}

interface HarmonyStorageUsage {
  keyName: string;
  keyExpression: string;
  relationType: 'READS_STORAGE' | 'WRITES_STORAGE' | 'BINDS_STORAGE';
  reason: string;
  lineNumber: number;
}

function extractHarmonyRouterNameMap(contents: ReadonlyMap<string, string>): Map<string, string> {
  const routerNames = new Map<string, string>();
  for (const content of contents.values()) {
    HARMONY_ROUTER_NAME_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HARMONY_ROUTER_NAME_RE.exec(content)) !== null) {
      routerNames.set(match[1], match[2]);
    }
  }
  return routerNames;
}

function normalizePathSegments(input: string): string {
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

function resolveHarmonyImportPath(
  filePath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalizePathSegments(`${dirname(filePath)}/${specifier}`);
  const candidates = [base, `${base}.ets`, `${base}/index.ets`];
  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function extractDecoratorNames(block: string): string[] {
  const names: string[] = [];
  HARMONY_DECORATOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_DECORATOR_RE.exec(block)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length - 1;
}

function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripCommentsAndStrings(content: string): string {
  return content.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*?\1/g,
    (match) => ' '.repeat(match.length),
  );
}

function parseHarmonyImports(
  filePath: string,
  content: string,
  knownPaths: ReadonlySet<string>,
): Map<string, HarmonyImportRef> {
  const imports = new Map<string, HarmonyImportRef>();
  HARMONY_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_IMPORT_RE.exec(content)) !== null) {
    const namedBlock = match[1] || match[3] || '';
    const defaultName = match[2] || null;
    const specifier = match[4];
    const resolvedFile = resolveHarmonyImportPath(filePath, specifier, knownPaths);

    if (defaultName) {
      imports.set(defaultName, { importedName: null, filePath: resolvedFile });
    }
    if (!namedBlock) continue;
    for (const rawName of namedBlock.replace(/[{}]/g, '').split(',')) {
      const item = rawName.trim();
      if (!item) continue;
      const alias = item.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) imports.set(alias[2], { importedName: alias[1], filePath: resolvedFile });
      else imports.set(item, { importedName: item, filePath: resolvedFile });
    }
  }
  return imports;
}

function collectHarmonyDeclarations(filePath: string, content: string): HarmonyDeclaration[] {
  const declarations: HarmonyDeclaration[] = [];
  HARMONY_UI_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_UI_DECL_RE.exec(content)) !== null) {
    const decorators = extractDecoratorNames(match[1]);
    const componentDecorators = decorators.filter((name) => HARMONY_COMPONENT_DECORATORS.has(name));
    const isEntry = decorators.includes('Entry');
    if (!isEntry && componentDecorators.length === 0) continue;

    const openIndex = content.indexOf('{', match.index + match[0].length);
    const closeIndex = openIndex >= 0 ? findMatchingBrace(content, openIndex) : -1;
    const body =
      openIndex >= 0 ? content.slice(openIndex + 1, closeIndex >= 0 ? closeIndex : content.length) : '';
    const name = match[2];
    declarations.push({
      name,
      filePath,
      isEntry,
      isRouteComponent: isEntry || decorators.includes('HMRouter'),
      isComponent: componentDecorators.length > 0,
      bodyStartLine: openIndex >= 0 ? lineNumberAt(content, openIndex + 1) + 1 : lineNumberAt(content, match.index) + 1,
      id: generateId('Component', `${filePath}:${name}`),
      body,
    });
  }
  return declarations;
}

function normalizeHarmonyStorageKeyExpression(rawValue: string): string | null {
  const value = rawValue.trim().replace(/;$/, '').trim();
  const literal = value.match(/^['"`]([^'"`]+)['"`]$/);
  if (literal) return literal[1];
  const member = value.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/);
  if (member) return member[1];
  return null;
}

function storageRelationForAppStorageMethod(
  method: string,
): 'READS_STORAGE' | 'WRITES_STORAGE' | 'BINDS_STORAGE' {
  if (method === 'get' || method === 'has') return 'READS_STORAGE';
  if (method === 'link' || method === 'prop' || method === 'setAndLink' || method === 'setAndProp') {
    return 'BINDS_STORAGE';
  }
  return 'WRITES_STORAGE';
}

function extractHarmonyStorageUsages(decl: HarmonyDeclaration): HarmonyStorageUsage[] {
  const usages: HarmonyStorageUsage[] = [];

  HARMONY_APP_STORAGE_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_APP_STORAGE_CALL_RE.exec(decl.body)) !== null) {
    const keyName = normalizeHarmonyStorageKeyExpression(match[2]);
    if (!keyName) continue;
    const method = match[1];
    usages.push({
      keyName,
      keyExpression: match[2].trim(),
      relationType: storageRelationForAppStorageMethod(method),
      reason: `harmony-appstorage-${method}`,
      lineNumber: decl.bodyStartLine + lineNumberAt(decl.body, match.index),
    });
  }

  HARMONY_STORAGE_DECORATOR_RE.lastIndex = 0;
  while ((match = HARMONY_STORAGE_DECORATOR_RE.exec(decl.body)) !== null) {
    const keyName = normalizeHarmonyStorageKeyExpression(match[2]);
    if (!keyName) continue;
    usages.push({
      keyName,
      keyExpression: match[2].trim(),
      relationType: 'BINDS_STORAGE',
      reason: `harmony-${match[1].toLowerCase()}`,
      lineNumber: decl.bodyStartLine + lineNumberAt(decl.body, match.index),
    });
  }

  return usages;
}

function extractHarmonyComponentCallNames(body: string): Set<string> {
  const names = new Set<string>();
  const searchable = stripCommentsAndStrings(body);
  HARMONY_CALL_NAME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_CALL_NAME_RE.exec(searchable)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function extractHarmonyClassReferenceNames(body: string): Set<string> {
  const names = new Set<string>();
  const searchable = stripCommentsAndStrings(body);
  HARMONY_CLASS_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HARMONY_CLASS_REF_RE.exec(searchable)) !== null) {
    names.add(match[1]);
  }
  for (const name of extractHarmonyComponentCallNames(body)) {
    if (/^[A-Z]/.test(name)) names.add(name);
  }
  return names;
}

function resolveHarmonyComponentReference(
  name: string,
  sourceFile: string,
  importMap: ReadonlyMap<string, HarmonyImportRef>,
  componentByFileAndName: ReadonlyMap<string, HarmonyDeclaration>,
  componentsByFile: ReadonlyMap<string, HarmonyDeclaration[]>,
  componentsByName: ReadonlyMap<string, HarmonyDeclaration[]>,
): HarmonyComponentResolution | null {
  const imported = importMap.get(name);
  if (imported?.filePath) {
    const importedName = imported.importedName || name;
    const exact =
      componentByFileAndName.get(`${imported.filePath}\0${importedName}`) ||
      componentByFileAndName.get(`${imported.filePath}\0${name}`);
    if (exact) return { component: exact, reason: 'harmony-component-usage:import' };
    const inFile = componentsByFile.get(imported.filePath) || [];
    if (inFile.length === 1) {
      return { component: inFile[0], reason: 'harmony-component-usage:default-import' };
    }
  }
  const sameFile = componentByFileAndName.get(`${sourceFile}\0${name}`);
  if (sameFile) return { component: sameFile, reason: 'harmony-component-usage:same-file' };
  const candidates = componentsByName.get(name) || [];
  if (candidates.length === 1) {
    return { component: candidates[0], reason: 'harmony-component-usage:unique-name' };
  }
  return null;
}

function resolveHarmonyClassReference(
  name: string,
  sourceFile: string,
  importMap: ReadonlyMap<string, HarmonyImportRef>,
  classByFileAndName: ReadonlyMap<string, HarmonyClassRef>,
  classesByFile: ReadonlyMap<string, HarmonyClassRef[]>,
  classesByName: ReadonlyMap<string, HarmonyClassRef[]>,
): HarmonyClassResolution | null {
  const imported = importMap.get(name);
  if (imported?.filePath) {
    const importedName = imported.importedName || name;
    const exact =
      classByFileAndName.get(`${imported.filePath}\0${importedName}`) ||
      classByFileAndName.get(`${imported.filePath}\0${name}`);
    if (exact) return { classNode: exact, reason: 'harmony-class-usage:import' };
    const inFile = classesByFile.get(imported.filePath) || [];
    if (inFile.length === 1) {
      return { classNode: inFile[0], reason: 'harmony-class-usage:default-import' };
    }
  }
  const sameFile = classByFileAndName.get(`${sourceFile}\0${name}`);
  if (sameFile) return { classNode: sameFile, reason: 'harmony-class-usage:same-file' };
  const candidates = classesByName.get(name) || [];
  if (candidates.length === 1) {
    return { classNode: candidates[0], reason: 'harmony-class-usage:unique-name' };
  }
  return null;
}

async function linkHarmonyComponentUsage(
  ctx: PipelineContext,
  allPaths: readonly string[],
  routeRegistry: ReadonlyMap<string, RouteEntry>,
): Promise<void> {
  const etsPaths = allPaths.map((p) => p.replace(/\\/g, '/')).filter((p) => p.endsWith('.ets'));
  if (etsPaths.length === 0) return;

  const knownPaths = new Set(etsPaths);
  const contents = await readFileContents(ctx.repoPath, etsPaths);
  const declarations: HarmonyDeclaration[] = [];
  const importsByFile = new Map<string, Map<string, HarmonyImportRef>>();
  for (const [filePath, content] of contents) {
    declarations.push(...collectHarmonyDeclarations(filePath, content));
    importsByFile.set(filePath, parseHarmonyImports(filePath, content, knownPaths));
  }

  const components = declarations.filter((d) => d.isComponent);
  if (components.length === 0) return;

  const componentByFileAndName = new Map<string, HarmonyDeclaration>();
  const componentsByFile = new Map<string, HarmonyDeclaration[]>();
  const componentsByName = new Map<string, HarmonyDeclaration[]>();
  for (const component of components) {
    componentByFileAndName.set(`${component.filePath}\0${component.name}`, component);
    const byFile = componentsByFile.get(component.filePath) || [];
    byFile.push(component);
    componentsByFile.set(component.filePath, byFile);
    const byName = componentsByName.get(component.name) || [];
    byName.push(component);
    componentsByName.set(component.name, byName);
  }

  const classByFileAndName = new Map<string, HarmonyClassRef>();
  const classesByFile = new Map<string, HarmonyClassRef[]>();
  const classesByName = new Map<string, HarmonyClassRef[]>();
  for (const node of ctx.graph.iterNodes()) {
    if (node.label !== 'Class') continue;
    const rawFilePath = node.properties.filePath;
    const rawName = node.properties.name;
    if (typeof rawFilePath !== 'string' || typeof rawName !== 'string') continue;
    const normalizedFilePath = rawFilePath.replace(/\\/g, '/');
    if (
      componentByFileAndName.has(`${rawFilePath}\0${rawName}`) ||
      componentByFileAndName.has(`${normalizedFilePath}\0${rawName}`)
    ) {
      continue;
    }
    const classRef: HarmonyClassRef = { id: node.id, name: rawName, filePath: normalizedFilePath };
    classByFileAndName.set(`${rawFilePath}\0${rawName}`, classRef);
    classByFileAndName.set(`${normalizedFilePath}\0${rawName}`, classRef);
    const byFile = classesByFile.get(normalizedFilePath) || [];
    byFile.push(classRef);
    classesByFile.set(normalizedFilePath, byFile);
    const byName = classesByName.get(rawName) || [];
    byName.push(classRef);
    classesByName.set(rawName, byName);
  }

  const routesByFile = new Map<string, string[]>();
  for (const [routeURL, entry] of routeRegistry) {
    const list = routesByFile.get(entry.filePath) || [];
    list.push(routeURL);
    routesByFile.set(entry.filePath, list);
  }

  const relationKeys = new Set<string>();
  const addStorageKeyNode = (usage: HarmonyStorageUsage, filePath: string): string => {
    const storageId = generateId('StorageKey', `AppStorage:${usage.keyName}`);
    if (!ctx.graph.getNode(storageId)) {
      ctx.graph.addNode({
        id: storageId,
        label: 'StorageKey',
        properties: {
          name: usage.keyName,
          filePath,
          startLine: usage.lineNumber,
          endLine: usage.lineNumber,
          language: 'TypeScript',
          storageKind: 'AppStorage',
          keyExpression: usage.keyExpression,
        },
      });
    }
    return storageId;
  };

  const addRouteComponent = (routeURL: string, component: HarmonyDeclaration): void => {
    const routeId = generateId('Route', routeURL);
    const key = `ROUTE_COMPONENT:${routeId}->${component.id}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    const componentNode = ctx.graph.getNode(component.id);
    if (componentNode) {
      componentNode.properties.isPage = true;
      componentNode.properties.routePath = routeURL;
    }
    ctx.graph.addRelationship({
      id: generateId('ROUTE_COMPONENT', key),
      sourceId: routeId,
      targetId: component.id,
      type: 'ROUTE_COMPONENT',
      confidence: 1.0,
      reason: 'harmony-route-component',
    });
  };

  const addUsage = (sourceId: string, target: HarmonyDeclaration, reason: string): void => {
    if (sourceId === target.id) return;
    const key = `USES_COMPONENT:${sourceId}->${target.id}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    ctx.graph.addRelationship({
      id: generateId('USES_COMPONENT', key),
      sourceId,
      targetId: target.id,
      type: 'USES_COMPONENT',
      confidence: reason.endsWith(':unique-name') ? 0.82 : 1.0,
      reason,
    });
  };

  const addClassUsage = (sourceId: string, target: HarmonyClassRef, reason: string): void => {
    if (sourceId === target.id) return;
    const key = `USES_CLASS:${sourceId}->${target.id}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    ctx.graph.addRelationship({
      id: generateId('USES_CLASS', key),
      sourceId,
      targetId: target.id,
      type: 'USES_CLASS',
      confidence: reason.endsWith(':unique-name') ? 0.82 : 1.0,
      reason,
    });
  };

  const addStorageUsage = (
    sourceId: string,
    sourceFile: string,
    usage: HarmonyStorageUsage,
  ): void => {
    const storageId = addStorageKeyNode(usage, sourceFile);
    const key = `${usage.relationType}:${sourceId}->${storageId}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    ctx.graph.addRelationship({
      id: generateId(usage.relationType, key),
      sourceId,
      targetId: storageId,
      type: usage.relationType,
      confidence: 1.0,
      reason: usage.reason,
    });
  };

  for (const decl of declarations) {
    if (decl.isRouteComponent && routesByFile.has(decl.filePath)) {
      for (const routeURL of routesByFile.get(decl.filePath) || []) {
        addRouteComponent(routeURL, decl);
      }
    }
    if (!decl.isComponent) continue;
    const importMap = importsByFile.get(decl.filePath) || new Map<string, HarmonyImportRef>();
    for (const name of extractHarmonyComponentCallNames(decl.body)) {
      const resolved = resolveHarmonyComponentReference(
        name,
        decl.filePath,
        importMap,
        componentByFileAndName,
        componentsByFile,
        componentsByName,
      );
      if (resolved) addUsage(decl.id, resolved.component, resolved.reason);
    }
    for (const name of extractHarmonyClassReferenceNames(decl.body)) {
      if (
        resolveHarmonyComponentReference(
          name,
          decl.filePath,
          importMap,
          componentByFileAndName,
          componentsByFile,
          componentsByName,
        )
      ) {
        continue;
      }
      const resolved = resolveHarmonyClassReference(
        name,
        decl.filePath,
        importMap,
        classByFileAndName,
        classesByFile,
        classesByName,
      );
      if (resolved) addClassUsage(decl.id, resolved.classNode, resolved.reason);
    }
    const storageUsages = extractHarmonyStorageUsages(decl);
    for (const usage of storageUsages) {
      addStorageUsage(decl.id, decl.filePath, usage);
      if (decl.isRouteComponent) {
        for (const routeURL of routesByFile.get(decl.filePath) || []) {
          addStorageUsage(generateId('Route', routeURL), decl.filePath, usage);
        }
      }
    }
  }

  if (isDev && relationKeys.size > 0) {
    logger.info(`Linked ${relationKeys.size} Harmony route/component/class/storage edges`);
  }
}

export interface RouteEntry {
  filePath: string;
  source: string;
}

export interface RoutesOutput {
  routeRegistry: Map<string, RouteEntry>;
}

export interface TemplateFetchCall {
  filePath: string;
  fetchURL: string;
  lineNumber: number;
}

const TEMPLATE_URL_PATTERNS: readonly RegExp[] = [
  /\b(?:action|href)\s*=\s*["']([^"']+)["']/gi,
  /\burl\s*:\s*["']([^"']+)["'](?!\s*\+)/g,
  // Laravel asset() points at static assets, not application routes; keep it
  // out of route matching so asset paths cannot collide with real route URLs.
  /\{\{[\s\S]{0,200}?\burl\(\s*["']([^"']+)["']\s*\)[\s\S]{0,200}?\}\}/g,
  /\{!![\s\S]{0,200}?\burl\(\s*["']([^"']+)["']\s*\)[\s\S]{0,200}?!\}/g,
];

const TEMPLATE_NAMED_ROUTE_PATTERNS: readonly RegExp[] = [
  // Parameterless Laravel route('name') helpers can be resolved from extracted
  // route names. Parameterized helpers are intentionally deferred because they
  // require binding runtime values onto route placeholders.
  /\{\{[\s\S]{0,200}?\broute\(\s*["']([^"']+)["']\s*\)[\s\S]{0,200}?\}\}/g,
  /\{!![\s\S]{0,200}?\broute\(\s*["']([^"']+)["']\s*\)[\s\S]{0,200}?!\}/g,
];

function hasRouteParameters(routeUrl: string): boolean {
  return /\{[^}]+\}/.test(routeUrl);
}

export const isTemplateRouteCandidate = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.endsWith('.html') ||
    normalized.endsWith('.htm') ||
    normalized.endsWith('.ejs') ||
    normalized.endsWith('.hbs') ||
    isBladeTemplateFilename(normalized)
  );
};

export function extractTemplateStaticFetchCalls(
  filePath: string,
  content: string,
  namedRouteUrls: ReadonlyMap<string, string> = new Map(),
): TemplateFetchCall[] {
  const calls: TemplateFetchCall[] = [];
  const seen = new Set<string>();

  for (const pattern of TEMPLATE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const normalized = normalizeFetchURL(match[1]);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      calls.push({ filePath, fetchURL: normalized, lineNumber: 0 });
    }
  }

  for (const pattern of TEMPLATE_NAMED_ROUTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const routeUrl = namedRouteUrls.get(match[1]);
      if (!routeUrl) continue;
      if (hasRouteParameters(routeUrl)) continue;
      const normalized = normalizeFetchURL(routeUrl);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      calls.push({ filePath, fetchURL: normalized, lineNumber: 0 });
    }
  }

  return calls;
}

export function normalizeExtractedRoutePath(routePath: string, prefix: string | null): string {
  const pathPart = routePath.trim().replace(/^\/+/, '').replace(/\/+$/g, '');
  const prefixPart = prefix?.trim().replace(/^\/+/, '').replace(/\/+$/g, '');
  const joined = prefixPart ? `/${prefixPart}${pathPart ? `/${pathPart}` : ''}` : `/${pathPart}`;
  return joined.replace(/\/+/g, '/') || '/';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const routesPhase: PipelinePhase<RoutesOutput> = {
  name: 'routes',
  deps: ['parse'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<RoutesOutput> {
    const {
      allPaths,
      allFetchCalls: parseFetchCalls,
      allFetchWrapperDefs,
      allExtractedRoutes,
      allDecoratorRoutes,
    } = getPhaseOutput<ParseOutput>(deps, 'parse');

    // Local copy — routes phase must not mutate upstream ParseOutput
    const allFetchCalls = [...parseFetchCalls];

    const routeRegistry = new Map<string, RouteEntry>();
    const routerNameFiles = allPaths.filter((p) =>
      HARMONY_ROUTER_NAME_FILE_RE.test(p.replace(/\\/g, '/')),
    );
    const harmonyRouterNames =
      routerNameFiles.length > 0
        ? extractHarmonyRouterNameMap(await readFileContents(ctx.repoPath, routerNameFiles))
        : new Map<string, string>();

    // Detect Expo Router app/ roots vs Next.js app/ roots (monorepo-safe)
    const expoAppRoots = new Set<string>();
    const nextjsAppRoots = new Set<string>();
    const expoAppPaths = new Set<string>();
    for (const p of allPaths) {
      const norm = p.replace(/\\/g, '/');
      const appIdx = norm.lastIndexOf('app/');
      if (appIdx < 0) continue;
      const root = norm.slice(0, appIdx + 4);
      if (/\/_layout\.(tsx?|jsx?)$/.test(norm)) expoAppRoots.add(root);
      if (/\/page\.(tsx?|jsx?)$/.test(norm)) nextjsAppRoots.add(root);
    }
    for (const root of nextjsAppRoots) expoAppRoots.delete(root);
    if (expoAppRoots.size > 0) {
      for (const p of allPaths) {
        const norm = p.replace(/\\/g, '/');
        const appIdx = norm.lastIndexOf('app/');
        if (appIdx >= 0 && expoAppRoots.has(norm.slice(0, appIdx + 4))) expoAppPaths.add(p);
      }
    }

    for (const p of allPaths) {
      if (expoAppPaths.has(p)) {
        const expoURL = expoFileToRouteURL(p);
        if (expoURL && !routeRegistry.has(expoURL)) {
          routeRegistry.set(expoURL, { filePath: p, source: 'expo-filesystem-route' });
          continue;
        }
      }
      const nextjsURL = nextjsFileToRouteURL(p);
      if (nextjsURL && !routeRegistry.has(nextjsURL)) {
        routeRegistry.set(nextjsURL, { filePath: p, source: 'nextjs-filesystem-route' });
        continue;
      }
      if (p.endsWith('.php')) {
        const phpURL = phpFileToRouteURL(p);
        if (phpURL && !routeRegistry.has(phpURL)) {
          routeRegistry.set(phpURL, { filePath: p, source: 'php-file-route' });
        }
      }
    }

    let duplicateRoutes = 0;
    const namedRouteRegistry = new Map<string, string>();
    const addRoute = (url: string, entry: RouteEntry) => {
      if (routeRegistry.has(url)) {
        duplicateRoutes++;
        return;
      }
      routeRegistry.set(url, entry);
    };

    const ensureSlash = (routePath: string): string =>
      routePath.startsWith('/') ? routePath : `/${routePath}`;
    const normalizeHarmonyRouteURL = (routePath: string): string => {
      const url = ensureSlash(routePath);
      const routeName = url.slice(1);
      const mapped = harmonyRouterNames.get(routeName);
      return mapped ? `/${mapped}` : url;
    };

    if (harmonyRouterNames.size > 0) {
      for (const call of allFetchCalls) {
        call.fetchURL = normalizeHarmonyRouteURL(call.fetchURL);
      }
    }

    for (const route of allExtractedRoutes) {
      if (!route.routePath) continue;
      const routeUrl = normalizeExtractedRoutePath(route.routePath, route.prefix);
      addRoute(routeUrl, {
        filePath: route.filePath,
        source: 'framework-route',
      });
      if (route.routeName && !namedRouteRegistry.has(route.routeName)) {
        namedRouteRegistry.set(route.routeName, routeUrl);
      }
    }
    for (const dr of allDecoratorRoutes) {
      const url =
        dr.decoratorName === 'HMRouter'
          ? normalizeHarmonyRouteURL(dr.routePath)
          : normalizeExtractedRoutePath(dr.routePath, dr.prefix ?? null);
      addRoute(url, {
        filePath: dr.filePath,
        source: `decorator-${dr.decoratorName}`,
      });
    }

    let handlerContents: Map<string, string> | undefined;
    if (routeRegistry.size > 0) {
      const handlerPaths = [...routeRegistry.values()].map((e) => e.filePath);
      handlerContents = await readFileContents(ctx.repoPath, handlerPaths);

      for (const [routeURL, entry] of routeRegistry) {
        const { filePath: handlerPath, source: routeSource } = entry;
        const content = handlerContents.get(handlerPath);

        const { responseKeys, errorKeys } = content
          ? handlerPath.endsWith('.php')
            ? extractPHPResponseShapes(content)
            : extractResponseShapes(content)
          : { responseKeys: undefined, errorKeys: undefined };

        const mwResult = content ? extractMiddlewareChain(content) : undefined;
        const middleware = mwResult?.chain;

        const routeNodeId = generateId('Route', routeURL);
        ctx.graph.addNode({
          id: routeNodeId,
          label: 'Route',
          properties: {
            name: routeURL,
            filePath: handlerPath,
            ...(responseKeys ? { responseKeys } : {}),
            ...(errorKeys ? { errorKeys } : {}),
            ...(middleware && middleware.length > 0 ? { middleware } : {}),
          },
        });

        const handlerFileId = generateId('File', handlerPath);
        ctx.graph.addRelationship({
          id: generateId('HANDLES_ROUTE', `${handlerFileId}->${routeNodeId}`),
          sourceId: handlerFileId,
          targetId: routeNodeId,
          type: 'HANDLES_ROUTE',
          confidence: 1.0,
          reason: routeSource,
        });
      }

      if (isDev) {
        logger.info(
          `🗺️ Route registry: ${routeRegistry.size} routes${duplicateRoutes > 0 ? ` (${duplicateRoutes} duplicate URLs skipped)` : ''}`,
        );
      }
    }

    await linkHarmonyComponentUsage(ctx, allPaths, routeRegistry);

    // ── Link Next.js project-level middleware.ts to routes ──
    if (routeRegistry.size > 0) {
      const middlewareCandidates = allPaths.filter(
        (p) =>
          p === 'middleware.ts' ||
          p === 'middleware.js' ||
          p === 'middleware.tsx' ||
          p === 'middleware.jsx' ||
          p === 'src/middleware.ts' ||
          p === 'src/middleware.js' ||
          p === 'src/middleware.tsx' ||
          p === 'src/middleware.jsx',
      );
      if (middlewareCandidates.length > 0) {
        const mwContents = await readFileContents(ctx.repoPath, middlewareCandidates);
        for (const [mwPath, mwContent] of mwContents) {
          const config = extractNextjsMiddlewareConfig(mwContent);
          if (!config) continue;
          const mwLabel =
            config.wrappedFunctions.length > 0 ? config.wrappedFunctions : [config.exportedName];

          const compiled = config.matchers
            .map(compileMatcher)
            .filter((m): m is NonNullable<typeof m> => m !== null);

          let linkedCount = 0;
          for (const [routeURL] of routeRegistry) {
            const matches =
              compiled.length === 0 ||
              compiled.some((cm) => compiledMatcherMatchesRoute(cm, routeURL));
            if (!matches) continue;

            const routeNodeId = generateId('Route', routeURL);
            const existing = ctx.graph.getNode(routeNodeId);
            if (!existing) continue;

            const currentMw = existing.properties.middleware ?? [];
            existing.properties.middleware = [
              ...mwLabel,
              ...currentMw.filter((m) => !mwLabel.includes(m)),
            ];
            linkedCount++;
          }
          if (isDev && linkedCount > 0) {
            logger.info(
              `🛡️ Linked ${mwPath} middleware [${mwLabel.join(', ')}] to ${linkedCount} routes`,
            );
          }
        }
      }
    }

    // Scan HTML/template files for safe static form/link/AJAX URL patterns.
    // Blade stays template-only here; it must not re-enter PHP provider paths.
    const htmlCandidates = allPaths.filter(isTemplateRouteCandidate);
    if (htmlCandidates.length > 0 && routeRegistry.size > 0) {
      const htmlContents = await readFileContents(ctx.repoPath, htmlCandidates);
      for (const [filePath, content] of htmlContents) {
        allFetchCalls.push(
          ...extractTemplateStaticFetchCalls(filePath, content, namedRouteRegistry),
        );
      }
    }

    // ── Extract Expo Router navigation patterns ──
    if (expoAppPaths.size > 0 && routeRegistry.size > 0) {
      const unreadExpoPaths = [...expoAppPaths].filter((p) => !handlerContents?.has(p));
      const extraContents =
        unreadExpoPaths.length > 0
          ? await readFileContents(ctx.repoPath, unreadExpoPaths)
          : new Map<string, string>();
      const allExpoContents = new Map([...(handlerContents ?? new Map()), ...extraContents]);
      for (const [filePath, content] of allExpoContents) {
        if (!expoAppPaths.has(filePath)) continue;
        for (const pattern of EXPO_NAV_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const url = match[2] ?? match[1];
            if (url && url.startsWith('/')) {
              allFetchCalls.push({ filePath, fetchURL: url, lineNumber: 0 });
            }
          }
        }
      }
    }

    // ── Cross-file fetch wrapper consumer extraction ──
    // When the parse phase discovered functions that internally call fetch(),
    // scan JS/TS consumer files for calls to those wrapper functions with
    // URL-like string arguments and add them to allFetchCalls so
    // processNextjsFetchRoutes can create FETCHES edges.
    if (allFetchWrapperDefs && allFetchWrapperDefs.length > 0 && routeRegistry.size > 0) {
      const wrapperNames = new Set(allFetchWrapperDefs.map((d) => d.functionName));
      const jsFiles = allPaths.filter((p) => /\.[jt]sx?$/.test(p));
      if (jsFiles.length > 0 && wrapperNames.size > 0) {
        const jsContents = await readFileContents(ctx.repoPath, jsFiles);
        for (const [filePath, content] of jsContents) {
          for (const name of wrapperNames) {
            const regex = new RegExp(
              `\\b${escapeRegex(name)}\\s*\\(\\s*['"\`](/[^'"\`\\s)]+)['"\`]`,
              'g',
            );
            let match;
            while ((match = regex.exec(content)) !== null) {
              allFetchCalls.push({
                filePath,
                fetchURL: match[1],
                lineNumber: content.substring(0, match.index).split('\n').length,
              });
            }
          }
        }
      }
    }

    if (routeRegistry.size > 0 && allFetchCalls.length > 0) {
      const routeURLToFile = new Map<string, string>();
      for (const [url, entry] of routeRegistry) routeURLToFile.set(url, entry.filePath);

      const consumerPaths = [...new Set(allFetchCalls.map((c) => c.filePath))];
      const consumerContents = await readFileContents(ctx.repoPath, consumerPaths);

      processNextjsFetchRoutes(ctx.graph, allFetchCalls, routeURLToFile, consumerContents);
      if (isDev) {
        logger.info(
          `🔗 Processed ${allFetchCalls.length} fetch() calls against ${routeRegistry.size} routes`,
        );
      }
    }

    return { routeRegistry };
  },
};
