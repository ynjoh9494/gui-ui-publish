import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const flipbook = await readFile('src/figma/flipbook.ts', 'utf8');
const instantiate = flipbook.slice(flipbook.indexOf('export function instantiate('), flipbook.indexOf('async function createFlipbook('));
await mkdir('tmp/template-migration', { recursive: true });
const out = await build({ entryPoints: ['scripts/figma-template-migration-fixture.ts'], bundle: true, write: false, format: 'iife', globalName: 'TMH', target: 'es2020', minifyIdentifiers: true, minifySyntax: true,
  plugins: [{ name: 'small-figma-harness', setup(api) {
    api.onLoad({ filter: /[\\/]core[\\/]copy\.ts$/ }, () => ({ contents: 'export const COPY = new Proxy({}, { get: (_, key) => String(key) });', loader: 'ts' }));
    api.onLoad({ filter: /[\\/]figma[\\/]flipbook\.ts$/ }, () => ({ contents: "export const FLIPBOOK_KEY='flipbookOf', NODE_KEY='flipbookNode', TEMPLATE_KEY='flipbookTemplate'; const inAutoLayout=n=>n.parent&&'layoutMode'in n.parent&&n.parent.layoutMode!=='NONE';" + instantiate, loader: 'ts' }));
  } }] });
const code = out.outputFiles[0].text;
await writeFile('tmp/template-migration/figma-harness.js', code);
console.log(`Figma harness: ${code.length} characters`);
