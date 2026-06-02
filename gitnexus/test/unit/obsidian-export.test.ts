import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildObsidianExportPlan,
  resolveObsidianExportDir,
} from '../../src/cli/obsidian-export.js';

describe('buildObsidianExportPlan', () => {
  it('renders Obsidian wiki links for incoming and outgoing graph relationships', () => {
    const plan = buildObsidianExportPlan({
      repo: 'demo',
      nodes: [
        {
          id: 'Component:src/DevicePage.ets:DevicePage',
          label: 'Component',
          name: 'DevicePage',
          filePath: 'src/DevicePage.ets',
          startLine: 10,
        },
        {
          id: 'Class:src/DeviceStore.ets:DeviceStore',
          label: 'Class',
          name: 'DeviceStore',
          filePath: 'src/DeviceStore.ets',
        },
      ],
      relationships: [
        {
          sourceId: 'Component:src/DevicePage.ets:DevicePage',
          targetId: 'Class:src/DeviceStore.ets:DeviceStore',
          type: 'USES_CLASS',
        },
      ],
    });

    const componentNote = plan.notes.find((note) => note.relativePath === 'Component/DevicePage.md');
    const classNote = plan.notes.find((note) => note.relativePath === 'Class/DeviceStore.md');

    expect(plan.relationshipCount).toBe(1);
    expect(componentNote?.content).toContain('[[Class/DeviceStore|DeviceStore]] `Class`');
    expect(classNote?.content).toContain('[[Component/DevicePage|DevicePage]] `Component`');
    expect(plan.index.content).toContain('- Relationships: 1');
  });

  it('keeps duplicate note paths unique and falls back to symbol ids for nameless nodes', () => {
    const plan = buildObsidianExportPlan({
      repo: 'demo',
      nodes: [
        {
          id: 'Class:src/a/DeviceStore.ets:DeviceStore',
          label: 'Class',
          name: 'DeviceStore',
          filePath: 'src/a/DeviceStore.ets',
        },
        {
          id: 'Class:src/b/DeviceStore.ets:DeviceStore',
          label: 'Class',
          name: 'DeviceStore',
          filePath: 'src/b/DeviceStore.ets',
        },
        {
          id: 'Method:src/Page.ets:',
          label: 'Method',
          name: '',
          filePath: 'src/Page.ets',
        },
      ],
      relationships: [],
    });

    const paths = plan.notes.map((note) => note.relativePath);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.some((notePath) => /^Class\/DeviceStore-[a-z0-9]+\.md$/.test(notePath))).toBe(
      true,
    );
    expect(paths).toContain('Method/src-Page.ets.md');
  });

  it('ignores relationships when one endpoint was not exported', () => {
    const plan = buildObsidianExportPlan({
      repo: 'demo',
      nodes: [
        {
          id: 'Component:src/DevicePage.ets:DevicePage',
          label: 'Component',
          name: 'DevicePage',
          filePath: 'src/DevicePage.ets',
        },
      ],
      relationships: [
        {
          sourceId: 'Component:src/DevicePage.ets:DevicePage',
          targetId: 'Class:src/DeviceStore.ets:DeviceStore',
          type: 'USES_CLASS',
        },
      ],
    });

    expect(plan.relationshipCount).toBe(0);
    expect(plan.index.content).toContain('- Relationships: 0');
  });
});

describe('resolveObsidianExportDir', () => {
  it('uses an explicit output directory when provided', () => {
    expect(resolveObsidianExportDir('demo', 'vault/gitnexus')).toBe(
      path.resolve('vault/gitnexus'),
    );
  });

  it('defaults to obsidian-exports under the current working directory', () => {
    expect(resolveObsidianExportDir('liberlive-harmonyOS')).toBe(
      path.resolve(process.cwd(), 'obsidian-exports', 'liberlive-harmonyOS'),
    );
  });
});
