import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLIPBOOK_KEY, prepareFlipbookTitle } from '../src/figma/flipbook.ts';
import { LINKS_KEY, PART_KEY } from '../src/core/templateParts.ts';

test('title-only rename uses the known frame after a page move and preserves other areas', async () => {
  const data = (values: Record<string, string>) => ({
    getSharedPluginData: (_ns: string, key: string) => values[key] ?? '',
    setSharedPluginData: (_ns: string, key: string, value: string) => { values[key] = value; },
  });
  const text = (role: string) => ({ type: 'TEXT', name: role, characters: 'old',
    ...data({ [PART_KEY]: role }), getRangeAllFontNames: () => [{ family: 'Test', style: 'Regular' }],
  });
  const title = text('title'), secondTitle = text('title'), chapter = text('chapter');
  const protectedArea = (role: string) => ({ type: 'FRAME', name: role, ...data({ [PART_KEY]: role }),
    get children(): never { throw new Error(`must not inspect ${role}`); },
  });
  const frame = { type: 'FRAME', id: 'node', name: 'old', parent: { id: 'moved-page' },
    ...data({ [FLIPBOOK_KEY]: 'fb', [LINKS_KEY]: '{"components":{}}' }),
    children: [title, secondTitle, chapter, protectedArea('gui'), protectedArea('description'), protectedArea('ids'), protectedArea('row')],
  };
  const reads: string[] = [], fonts: unknown[] = [];
  const globals = globalThis as unknown as { figma: PluginAPI };
  const previous = globals.figma;
  globals.figma = {
    getNodeByIdAsync: async (id: string) => { reads.push(id); assert.equal(id, 'node'); return frame; },
    loadFontAsync: async (font: unknown) => { fonts.push(font); },
  } as unknown as PluginAPI;
  try {
    (await prepareFlipbookTitle('ns', { flipbookId: 'fb', pageId: 'old-page', nodeId: 'node', title: 'New' })).apply();
    assert.deepEqual(reads, ['node']);
    assert.equal(fonts.length, 1);
    assert.deepEqual([title.characters, secondTitle.characters, frame.name, chapter.characters], ['New', 'New', 'New', 'old']);
    (await prepareFlipbookTitle('ns', { flipbookId: 'fb', pageId: 'old-page', nodeId: 'node', title: 'New' })).apply();
    assert.equal(fonts.length, 1, 'unchanged titles do not load fonts again');
  } finally { globals.figma = previous; }
});

test('font and partial write failures preserve both titles and allow the same rename again', async () => {
  const globals = globalThis as unknown as { figma: PluginAPI };
  const previous = globals.figma;
  for (const failure of ['font', 'write']) {
    let fail = true;
    const text = (id: string) => {
      const metadata: Record<string, string> = { [PART_KEY]: 'title', flipbookTitle: 'old' };
      return { type: 'TEXT', name: id, characters: 'old',
        getSharedPluginData: (_ns: string, key: string) => metadata[key] ?? '',
        setSharedPluginData: (_ns: string, key: string, value: string) => {
          if (failure === 'write' && fail && id === 'second' && value === 'New') { fail = false; throw new Error('write failed'); }
          metadata[key] = value;
        },
        getRangeAllFontNames: () => [{ family: id, style: 'Regular' }],
      };
    };
    const first = text('first'), second = text('second');
    const frame = { type: 'FRAME', name: 'old', children: [first, second],
      getSharedPluginData: (_ns: string, key: string) => key === FLIPBOOK_KEY ? 'fb' : key === LINKS_KEY ? '{"components":{}}' : '',
    };
    globals.figma = {
      getNodeByIdAsync: async () => frame,
      loadFontAsync: async (font: FontName) => { if (failure === 'font' && fail && font.family === 'second') throw new Error('font failed'); },
    } as unknown as PluginAPI;
    const item = { flipbookId: 'fb', pageId: 'p', nodeId: 'n', title: 'New' };
    try {
      if (failure === 'font') await assert.rejects(prepareFlipbookTitle('ns', item), /font failed/);
      else {
        const prepared = await prepareFlipbookTitle('ns', item);
        assert.throws(() => prepared.apply(), /write failed/);
      }
      assert.deepEqual([first.characters, second.characters, frame.name], ['old', 'old', 'old']);
      assert.deepEqual([first, second].map(n => n.getSharedPluginData('ns', 'flipbookTitle')), ['old', 'old']);
      fail = false;
      (await prepareFlipbookTitle('ns', item)).apply();
      assert.deepEqual([first.characters, second.characters, frame.name], ['New', 'New', 'New']);
    } finally { globals.figma = previous; }
  }
});
