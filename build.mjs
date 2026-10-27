// dist/code.js: 플러그인 본체, dist/ui.html: 플러그인 UI(스크립트·스타일 인라인), dist/preview.html: 브라우저 미리보기
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const common = { bundle: true, write: false, target: 'es2017', charset: 'utf8', logLevel: 'warning' };

async function bundle(entry) {
  const result = await build({ ...common, entryPoints: [entry], format: 'iife' });
  // 인라인 스크립트가 중간에 닫히지 않도록 막는다.
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

await mkdir('dist', { recursive: true });
await writeFile('dist/code.js', await bundle('src/main.ts'));

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

await writeFile('dist/ui.html', page('GUI·UI Publish', '<div id="app"></div>', await bundle('src/ui/index.ts')));

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
await writeFile('dist/preview.html', page('GUI·UI Publish 미리보기',
  '<div id="app"></div><aside><div id="tools"></div><h2>캔버스 이동 기록</h2><div id="log"></div></aside>',
  await bundle('src/ui/preview.ts'), previewCss).replace('<body>', '<body class="preview">'));

console.log('dist/code.js, dist/ui.html, dist/preview.html');
