import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareFlipbookTitle, FLIPBOOK_KEY } from '../src/figma/flipbook.ts';
import { LINKS_KEY, PART_KEY } from '../src/core/templateParts.ts';

function fixture() {
  const data = (initial: Record<string, string> = {}) => ({
    getSharedPluginData: (_ns: string, key: string) => initial[key] ?? '',
    setSharedPluginData: (_ns: string, key: string, value: string) => { initial[key] = value; },
  });
  const text = (role: string, value = 'old') => ({ type: 'TEXT', characters: value, visible: true, name: role,
    ...data({ [PART_KEY]: role }), getRangeAllFontNames: () => [{ family: 'Test', style: 'Regular' }],
  });
  const title = text('title'), chapter = text('chapter');
  const id1 = text(''), id2 = text('');
  const tag1 = { type: 'FRAME', visible: true, children: [id1], ...data() };
  const tag2 = { type: 'FRAME', visible: true, children: [id2], ...data() };
  const ids = { type: 'FRAME', visible: true, children: [tag1, tag2], ...data({ [PART_KEY]: 'ids' }) };
  const protectedArea = (role: string) => ({ type: 'FRAME', ...data({ [PART_KEY]: role }), get children(): never { throw new Error('protected ' + role); } });
  const frame = { type: 'FRAME', id: 'node', name: 'old', ...data({ [FLIPBOOK_KEY]: 'fb', [LINKS_KEY]: '{"components":{}}' }), children: [title, chapter, ids, protectedArea('gui'), protectedArea('description'), protectedArea('row')] };
  return { frame, title, chapter, ids, id1, tag1, tag2 };
}

test('metadata updates only title, Chapter, one visible ID and frame name, and rolls back', async () => {
  const f = fixture();
  const global = globalThis as unknown as { figma: PluginAPI };
  const previous = global.figma;
  global.figma = { getNodeByIdAsync: async () => f.frame, loadFontAsync: async () => {} } as unknown as PluginAPI;
  try {
    const update = await prepareFlipbookTitle('ns', { flipbookId: 'fb', pageId: 'p', nodeId: 'node', title: 'Any title', chapter: 'Live', screenId: 'ST_LI_002', frameName: 'ST_LI_002 \u00b7 Any title' });
    update.apply();
    assert.deepEqual([f.title.characters, f.chapter.characters, f.id1.characters, f.frame.name], ['Any title', 'Live', 'ST_LI_002', 'ST_LI_002 \u00b7 Any title']);
    assert.equal(f.tag1.visible, true);
    assert.equal(f.tag2.visible, false);
    update.rollback();
    assert.deepEqual([f.title.characters, f.chapter.characters, f.id1.characters, f.frame.name], ['old', 'old', 'old', 'old']);
    assert.equal(f.tag2.visible, true);
  } finally { global.figma = previous; }
});

test('a concurrent metadata change rejects the prepared update before writing', async () => {
  const f = fixture();
  const global = globalThis as unknown as { figma: PluginAPI };
  const previous = global.figma;
  global.figma = { getNodeByIdAsync: async () => f.frame, loadFontAsync: async () => {} } as unknown as PluginAPI;
  try {
    const update = await prepareFlipbookTitle('ns', { flipbookId: 'fb', pageId: 'p', nodeId: 'node', title: 'New', chapter: 'Live', screenId: 'ST_LI_002' });
    f.id1.characters = 'someone else';
    assert.throws(() => update.apply());
    assert.equal(f.title.characters, 'old');
    assert.equal(f.id1.characters, 'someone else');
    assert.equal(f.tag2.visible, true);
  } finally { global.figma = previous; }
});
