import { COPY } from '../core/copy.ts';
// Figma 없이 브라우저에서 UI와 Publish 흐름을 확인하는 미리보기. 가짜 환경(demo.ts)에 실제 Controller와 UI를 연결하고,
// 오른쪽 도구로 원본 수정·복제·삭제와 플러그인 명령 전환을 흉내 낸다.
import { serializeRichText } from '../core/richText.ts';
import type { ToMain } from '../core/wire.ts';
import { Controller } from '../controller.ts';
import { startApp } from './app.ts';
import { createDemo, DEMO_PAGE, DEMO_VERSION_PAGE } from './demo.ts';

const params = new URLSearchParams(location.search);
const log = document.getElementById('log')!;

function write(text: string) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString('ko-KR')}  ${text}`;
  log.prepend(line);
}

const demo = createDemo({
  // 미리보기 도구의 「GUI Publish / UI Flipbook」 버튼으로 바꾼다.
  mode: params.get('mode') === 'ui' ? 'UI' : 'GUI',
  actor: { id: 'preview', name: COPY.uiPreview013 },
  fingerprintMs: 40, syncMs: 300, revealMs: 150,
  slowLoad: params.has('slow-load'), tallThumb: params.has('tall-thumb'), instrument: true,
  log: write,
  canvasChanged: () => setTimeout(renderTools, 0),
  // 플러그인 창 크기 손잡이를 흉내 낸다.
  resize(width, height) { const app = document.getElementById('app')!; app.style.width = `${width}px`; app.style.height = `${height}px`; },
});
const { host, kv, frames, flipbooks, uiEdits } = demo;
const controller = new Controller(host);

// 미리보기 조작: 원본 수정·복제·삭제를 흉내 낸다.
// 저장된 화면 이름. 미리보기 도구 표시용
function screenName(screenId: string): string {
  try { return JSON.parse(kv.get(`scr:${screenId}`)).name; } catch { return screenId; }
}

function renderTools() {
  const tools = document.getElementById('tools')!;
  tools.innerHTML = `<h2>${COPY.uiPreview031}</h2>` + frames.map(f => `
    <div class="frame"><span>${f.pageId === DEMO_VERSION_PAGE.id ? `${DEMO_VERSION_PAGE.name} / ` : ''}${f.name}</span><small>${f.content}${f.tag ? COPY.uiPreview032 : ''}</small>
      <button data-edit="${f.nodeId}">${COPY.uiPreview033}</button><button data-rename="${f.nodeId}">${COPY.uiPreview034}</button>
      <button data-dup="${f.nodeId}">${COPY.uiPreview035}</button><button data-del="${f.nodeId}">${COPY.uiPreview036}</button></div>`).join('') +
    (flipbooks.size ? `<h2>${COPY.uiPreview037}</h2>` + [...flipbooks.keys()].map(screenId => `
    <div class="frame"><span>${screenName(screenId)}</span><small>${COPY.uiPreview038} ${uiEdits.get(screenId) ?? 0}${COPY.uiPreview039}</small>
      <button data-uiedit="${screenId}">${COPY.uiPreview038}</button></div>`).join('') : '') +
    `<p>${COPY.uiPreview040} <b>${COPY.uiPreview041}</b>${COPY.uiPreview042}</p><button data-reset>${COPY.uiPreview043}</button>` +
    `<h2>새 버전 페이지</h2><button data-version ${demo.hasVersionPage() ? 'disabled' : ''}>다른 파일에서 붙여 넣기</button><p>원본 페이지의 화면을 새 노드·제각각 이름으로 복사하고, 두 번째 화면은 내용을 고치고 새 화면 하나를 더합니다.</p>` +
    `<h2>플러그인 명령</h2><button data-mode="GUI" ${host.mode === 'GUI' ? 'disabled' : ''}>GUI Publish</button> <button data-mode="UI" ${host.mode === 'UI' ? 'disabled' : ''}>UI Flipbook</button>` +
    `<h2>${COPY.uiPreview052} · ${demo.text.name}</h2><pre class="preview-text"></pre>`;
  tools.querySelector('.preview-text')!.textContent = serializeRichText(demo.text.paragraphs);
}

document.getElementById('tools')!.addEventListener('click', ev => {
  const el = ev.target as HTMLElement;
  const id = el.dataset.edit ?? el.dataset.rename ?? el.dataset.dup ?? el.dataset.del;
  const f = frames.find(x => x.nodeId === id);
  if (el.dataset.edit && f) { demo.editFrame(f); write(`${f.name} ${COPY.uiPreview044}${f.content})`); }
  if (el.dataset.rename && f) { f.name += COPY.uiPreview045; write(`${f.name} ${COPY.uiPreview046}`); }
  if (el.dataset.dup && f) { const copy = { ...f, nodeId: `${f.nodeId}-c${Date.now() % 1000}`, name: `${f.name} ${COPY.uiPreview047}` }; frames.splice(frames.indexOf(f) + 1, 0, copy); write(`${f.name} ${COPY.uiPreview048}`); }
  if (el.dataset.del && f) { frames.splice(frames.indexOf(f), 1); write(`${f.name} ${COPY.uiPreview036}`); }
  if (el.dataset.uiedit) { const n = (uiEdits.get(el.dataset.uiedit) ?? 0) + 1; uiEdits.set(el.dataset.uiedit, n); write(`${screenName(el.dataset.uiedit)} ${COPY.uiPreview049}${n}${COPY.uiPreview050}`); }
  // 플러그인 메뉴에서 다른 명령을 실행한 것처럼 바꾼다. 파일 데이터(kv)는 그대로다.
  if (el.dataset.mode) { host.mode = el.dataset.mode as typeof host.mode; void controller.handle({ type: 'ready' }); }
  if (el.dataset.version !== undefined && !demo.hasVersionPage()) write(`${DEMO_VERSION_PAGE.name}: ${demo.pasteVersionPage()}개 프레임 붙여 넣음`);
  if (el.dataset.reset !== undefined) { for (const k of kv.keys()) kv.set(k, ''); frames.forEach(x => (x.tag = null)); location.reload(); }
  renderTools();
});

renderTools();
// 첫 실행 시 범위를 지정해 둔다.
kv.set('project', JSON.stringify({ schema: 1, scopePageIds: [DEMO_PAGE.id], scopeSectionIds: [], templateNodeId: 'tpl', templateName: 'Flipbook-Template', policyTemplateNodeId: null, policyTemplateName: null, dataPageId: null, flipbookPageIds: ['0:2'], flipbookPageId: '0:2', utcOffsetMinutes: 540 }));

startApp({
  send: (m: ToMain) => { void controller.handle(m); },
  listen: handler => demo.listen(m => setTimeout(() => handler(m), 0)),
}, document.getElementById('app')!);
