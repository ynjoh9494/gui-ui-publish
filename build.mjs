// tmp/build/: 검사 전용 본체·UI·미리보기. 실제 dist 전환은 activate-build만 담당한다.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Validation builds never touch the manifest's live dist directory.
const outDir = 'tmp/build';

const common = { bundle: true, write: false, target: 'es2017', charset: 'utf8', logLevel: 'warning' };

async function bundle(entry) {
  const result = await build({ ...common, entryPoints: [entry], format: 'iife' });
  // 인라인 스크립트가 중간에 닫히지 않도록 막는다.
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'code.js'), await bundle('src/main.ts'));

// Screen ID 글꼴(Roboto Condensed 라틴 600, SIL OFL 1.1: src/ui/fonts/OFL.txt). 외부 통신을 하지 않으므로 data URL로 넣는다.
const idFont = (await readFile('src/ui/fonts/roboto-condensed-latin-600-normal.woff2')).toString('base64');
const fontCss = `/* Roboto Condensed: Copyright 2011 Google Inc. SIL Open Font License 1.1 */
@font-face { font-family: "Roboto Condensed"; font-style: normal; font-weight: 600; src: url(data:font/woff2;base64,${idFont}) format("woff2"); }
`;
const css = fontCss + await readFile('src/ui/styles.css', 'utf8');
const page = (title, body, script, extraCss = '') => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${css}${extraCss}</style></head>
<body>${body}<script>${script}</script></body></html>
`;

await writeFile(join(outDir, 'ui.html'), page('GUI·UI Publish', '<div id="app"></div>', await bundle('src/ui/index.ts')));

const previewCss = `
body.preview { display: flex; gap: 16px; padding: 16px; height: auto; min-height: 100%; background: #e9ecef; flex-wrap: wrap; }
.preview #app { width: 640px; height: 456px; flex: none; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; background: var(--bg); }
.preview aside { flex: 1 1 320px; min-width: 280px; }
.preview aside h2 { font-size: 13px; }
.preview .frame { display: flex; gap: 4px; align-items: center; padding: 3px 0; }
.preview .frame span { flex: 1; }
.preview .frame small { color: #868e96; }
.preview .preview-text { tab-size: 2; font: 11px/1.5 ui-monospace, monospace; background: #fff; border-radius: 6px; padding: 8px; margin: 0; white-space: pre-wrap; }
.preview #log { font: 11px/1.5 ui-monospace, monospace; background: #fff; border-radius: 6px; padding: 8px; max-height: 260px; overflow: auto; }
@media (max-width: 520px) { .preview #app { width: 100%; } }`;
await writeFile(join(outDir, 'preview.html'), page('GUI·UI Publish 미리보기',
  '<div id="app"></div><aside><div id="tools"></div><h2>캔버스 이동 기록</h2><div id="log"></div></aside>',
  await bundle('src/ui/preview.ts'), previewCss).replace('<body>', '<body class="preview">'));

const hashes = {};
for (const file of ['code.js', 'ui.html', 'preview.html']) hashes[file] = createHash('sha256').update(await readFile(join(outDir, file))).digest('hex');
await writeFile(join(outDir, 'build.json'), JSON.stringify({ builtAt: new Date().toISOString(), hashes }, null, 2));
console.log('Validation build: tmp/build/code.js, ui.html, preview.html (live dist unchanged)');
