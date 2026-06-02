import fs from 'fs/promises';
import path from 'path';
import { writeSync } from 'node:fs';
import { LocalBackend, VALID_NODE_LABELS } from '../mcp/local/local-backend.js';

const DEFAULT_LABELS = ['Component', 'Class', 'Route', 'StorageKey'] as const;
const DEFAULT_RELATION_TYPES = [
  'USES_COMPONENT',
  'ROUTE_COMPONENT',
  'USES_CLASS',
  'READS_STORAGE',
  'WRITES_STORAGE',
  'BINDS_STORAGE',
  'EXTENDS',
  'IMPLEMENTS',
] as const;
const DEFAULT_EXPORT_FOLDER = 'obsidian-exports';

interface ExportNode {
  id: string;
  label: string;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
}

interface ExportRelationship {
  sourceId: string;
  targetId: string;
  type: string;
}

export interface ObsidianExportData {
  repo: string;
  nodes: ExportNode[];
  relationships: ExportRelationship[];
}

export interface ObsidianExportOptions {
  outDir: string;
  labels?: string[];
  relationTypes?: string[];
  limit?: number;
}

export interface ObsidianNote {
  nodeId: string;
  relativePath: string;
  content: string;
}

export interface ObsidianExportPlan {
  notes: ObsidianNote[];
  index: ObsidianNote;
  relationshipCount: number;
}

function output(message: string): void {
  writeSync(1, `${message}\n`);
}

export function resolveObsidianExportDir(repo: string, outDir?: string): string {
  const explicitOutDir = outDir?.trim();
  if (explicitOutDir) return path.resolve(explicitOutDir);
  return path.resolve(process.cwd(), DEFAULT_EXPORT_FOLDER, safeFileName(repo));
}

function parseCsvOption(value: string | undefined, defaults: readonly string[]): string[] {
  if (!value?.trim()) return [...defaults];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function quoteCypherString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function literalList(values: readonly string[]): string {
  return `[${values.map(quoteCypherString).join(', ')}]`;
}

function safeDisplayName(node: Pick<ExportNode, 'id' | 'name'>): string {
  if (node.name.trim()) return node.name.trim();
  return node.id.split(':').filter(Boolean).pop() ?? node.id;
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'unnamed';
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

function escapeAlias(value: string): string {
  return value.replace(/\|/g, '-').replace(/\]\]/g, ']] ');
}

function relationHeading(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function buildObsidianExportPlan(data: ObsidianExportData): ObsidianExportPlan {
  const nodes = [...data.nodes].sort((a, b) => {
    const labelCmp = a.label.localeCompare(b.label);
    if (labelCmp !== 0) return labelCmp;
    return safeDisplayName(a).localeCompare(safeDisplayName(b)) || a.id.localeCompare(b.id);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pathById = new Map<string, string>();
  const usedPaths = new Set<string>();

  for (const node of nodes) {
    const baseName = safeFileName(safeDisplayName(node));
    const folder = safeFileName(node.label);
    let relativePath = `${folder}/${baseName}.md`;
    const normalized = relativePath.toLowerCase();
    if (usedPaths.has(normalized)) {
      relativePath = `${folder}/${baseName}-${shortHash(node.id)}.md`;
    }
    usedPaths.add(relativePath.toLowerCase());
    pathById.set(node.id, relativePath);
  }

  const incomingByNode = new Map<string, ExportRelationship[]>();
  const outgoingByNode = new Map<string, ExportRelationship[]>();
  let relationshipCount = 0;
  for (const relationship of data.relationships) {
    if (!nodeById.has(relationship.sourceId) || !nodeById.has(relationship.targetId)) continue;
    if (!outgoingByNode.has(relationship.sourceId)) outgoingByNode.set(relationship.sourceId, []);
    if (!incomingByNode.has(relationship.targetId)) incomingByNode.set(relationship.targetId, []);
    outgoingByNode.get(relationship.sourceId)!.push(relationship);
    incomingByNode.get(relationship.targetId)!.push(relationship);
    relationshipCount += 1;
  }

  const wikiLink = (targetId: string): string => {
    const target = nodeById.get(targetId);
    const targetPath = pathById.get(targetId);
    if (!target || !targetPath) return '';
    const linkTarget = targetPath.replace(/\.md$/i, '').replace(/\\/g, '/');
    return `[[${linkTarget}|${escapeAlias(safeDisplayName(target))}]]`;
  };

  const renderRelationshipSection = (
    title: string,
    relationships: ExportRelationship[],
    direction: 'outgoing' | 'incoming',
  ): string => {
    if (relationships.length === 0) return `## ${title}\n\n_None._\n`;

    const byType = new Map<string, ExportRelationship[]>();
    for (const relationship of relationships) {
      if (!byType.has(relationship.type)) byType.set(relationship.type, []);
      byType.get(relationship.type)!.push(relationship);
    }

    const lines: string[] = [`## ${title}`, ''];
    for (const [type, typedRelationships] of [...byType.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      lines.push(`### ${relationHeading(type)}`);
      const sorted = [...typedRelationships].sort((a, b) => {
        const nodeA = nodeById.get(direction === 'outgoing' ? a.targetId : a.sourceId);
        const nodeB = nodeById.get(direction === 'outgoing' ? b.targetId : b.sourceId);
        return safeDisplayName(nodeA ?? { id: '', name: '' }).localeCompare(
          safeDisplayName(nodeB ?? { id: '', name: '' }),
        );
      });
      for (const relationship of sorted) {
        const linkedId = direction === 'outgoing' ? relationship.targetId : relationship.sourceId;
        const linkedNode = nodeById.get(linkedId);
        if (!linkedNode) continue;
        lines.push(`- ${wikiLink(linkedId)} \`${linkedNode.label}\``);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
  };

  const notes = nodes.map((node) => {
    const title = safeDisplayName(node);
    const outgoing = outgoingByNode.get(node.id) ?? [];
    const incoming = incomingByNode.get(node.id) ?? [];
    const tags = [`gitnexus`, `gitnexus/${node.label.toLowerCase()}`];
    const frontmatter = [
      '---',
      `gitnexus_id: ${escapeYaml(node.id)}`,
      `repo: ${escapeYaml(data.repo)}`,
      `type: ${escapeYaml(node.label)}`,
      `symbol: ${escapeYaml(title)}`,
      `source: ${escapeYaml(node.filePath || '')}`,
      ...(node.startLine ? [`start_line: ${node.startLine}`] : []),
      ...(node.endLine ? [`end_line: ${node.endLine}`] : []),
      'tags:',
      ...tags.map((tag) => `  - ${escapeYaml(tag)}`),
      '---',
      '',
    ].join('\n');

    const source = node.filePath
      ? `## Source\n\n\`${node.filePath}${node.startLine ? `:${node.startLine}` : ''}\`\n`
      : '## Source\n\n_None._\n';

    const content = [
      frontmatter,
      `# ${title}`,
      '',
      `> GitNexus ${node.label}`,
      '',
      source,
      renderRelationshipSection('Outgoing', outgoing, 'outgoing'),
      renderRelationshipSection('Incoming', incoming, 'incoming'),
    ].join('\n');

    return {
      nodeId: node.id,
      relativePath: pathById.get(node.id)!,
      content,
    };
  });

  const indexContent = [
    '---',
    `repo: ${escapeYaml(data.repo)}`,
    'type: "GitNexusExportIndex"',
    'tags:',
    '  - "gitnexus"',
    '  - "gitnexus/index"',
    '---',
    '',
    `# GitNexus Export - ${data.repo}`,
    '',
    `- Nodes: ${notes.length}`,
    `- Relationships: ${relationshipCount}`,
    '',
    '## Notes',
    '',
    ...notes.map((note) => {
      const node = nodeById.get(note.nodeId)!;
      return `- [[${note.relativePath.replace(/\.md$/i, '').replace(/\\/g, '/')}|${escapeAlias(
        safeDisplayName(node),
      )}]] \`${node.label}\``;
    }),
    '',
  ].join('\n');

  return {
    notes,
    index: {
      nodeId: '__gitnexus_export_index__',
      relativePath: 'GitNexus Export.md',
      content: indexContent,
    },
    relationshipCount,
  };
}

async function writePlan(outDir: string, plan: ObsidianExportPlan): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  for (const note of [...plan.notes, plan.index]) {
    const targetPath = path.join(outDir, note.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, note.content, 'utf-8');
  }
}

function validateLabels(labels: string[]): string[] {
  const invalid = labels.filter((label) => !VALID_NODE_LABELS.has(label));
  if (invalid.length > 0) {
    throw new Error(`Unknown node type(s): ${invalid.join(', ')}`);
  }
  return labels;
}

async function loadExportData(
  backend: LocalBackend,
  repo: string,
  labels: string[],
  relationTypes: string[],
  limit?: number,
): Promise<ObsidianExportData> {
  const labelList = literalList(labels);
  const relationList = literalList(relationTypes);
  const nodeLimit = Number.isFinite(limit) && limit && limit > 0 ? `LIMIT ${Math.trunc(limit)}` : '';

  const nodeRows = await backend.executeCypher(
    repo,
    `
    MATCH (n)
    WHERE labels(n) IN ${labelList}
    RETURN n.id AS id, labels(n) AS label, n.name AS name, n.filePath AS filePath,
           n.startLine AS startLine, n.endLine AS endLine
    ORDER BY label, name, id
    ${nodeLimit}
  `,
  );
  if (!Array.isArray(nodeRows)) {
    throw new Error(nodeRows?.error || 'Failed to load nodes for Obsidian export');
  }

  const nodes = nodeRows.map((row) => ({
    id: String(row.id ?? ''),
    label: String(row.label ?? ''),
    name: String(row.name ?? ''),
    filePath: String(row.filePath ?? ''),
    startLine: typeof row.startLine === 'number' ? row.startLine : undefined,
    endLine: typeof row.endLine === 'number' ? row.endLine : undefined,
  }));

  const relationRows = await backend.executeCypher(
    repo,
    `
    MATCH (source)-[rel:CodeRelation]->(target)
    WHERE rel.type IN ${relationList}
      AND labels(source) IN ${labelList}
      AND labels(target) IN ${labelList}
    RETURN source.id AS sourceId, target.id AS targetId, rel.type AS type
    ORDER BY type, sourceId, targetId
  `,
  );
  if (!Array.isArray(relationRows)) {
    throw new Error(relationRows?.error || 'Failed to load relationships for Obsidian export');
  }

  return {
    repo,
    nodes,
    relationships: relationRows.map((row) => ({
      sourceId: String(row.sourceId ?? ''),
      targetId: String(row.targetId ?? ''),
      type: String(row.type ?? ''),
    })),
  };
}

export async function obsidianExportCommand(options?: {
  repo?: string;
  out?: string;
  types?: string;
  relations?: string;
  limit?: string;
}): Promise<void> {
  const repo = options?.repo?.trim();
  if (!repo) {
    throw new Error('Usage: gitnexus export obsidian --repo <name> [--out <vault-folder>]');
  }
  const outDir = resolveObsidianExportDir(repo, options?.out);

  const labels = validateLabels(parseCsvOption(options?.types, DEFAULT_LABELS));
  const relationTypes = parseCsvOption(options?.relations, DEFAULT_RELATION_TYPES);
  const parsedLimit = options?.limit ? Number.parseInt(options.limit, 10) : undefined;

  const backend = new LocalBackend();
  try {
    const ok = await backend.init();
    if (!ok) throw new Error('No indexed repositories found. Run: gitnexus analyze');

    const data = await loadExportData(backend, repo, labels, relationTypes, parsedLimit);
    const plan = buildObsidianExportPlan(data);
    await writePlan(outDir, plan);

    output(
      `Exported ${plan.notes.length} Obsidian notes and ${plan.relationshipCount} relationships to ${outDir}`,
    );
  } finally {
    await backend.dispose().catch(() => {});
  }
}
