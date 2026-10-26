import { baseline } from './core/compare.ts';
import { COPY } from './core/copy.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './core/fingerprint.ts';
import { flowUpdates } from './core/flow.ts';
import { formatFrameName } from './core/screenName.ts';
import { keys, lastGui, Store } from './core/store.ts';
import type { GuiRecord, GuiThumb, Screen } from './core/types.ts';
import type { Host } from './host.ts';

// 썸네일 다시 만들기(2026-10-26 사용자 결정, 임시 명령). 썸네일 이미지를 1/2 해상도로 바꾼 뒤 이미 배포한 화면을 한 번 다시 만든다.
// 작업 파일에서 한 번 실행한 뒤 이 파일, main.ts의 분기, manifest.json 메뉴, COPY의 rethumb 문구, updateFlow의 sameVersion을 지운다.
// - 원본이 비교 기준(마지막 배포 또는 변경 무시)과 같은 화면만 만든다. 배포 뒤 바뀐 화면은 건너뛰고 다음 배포 때 바뀐다.
// - 썸네일 페이지에 넣은 뒤 마지막 GUI 기록의 썸네일 해시만 바꾼다(버전·크기는 그대로). 바꾼 기록마다 감사 기록을 남긴다.
// - 그 화면이 든 플로우는 같은 버전이어도 새 이미지로 채운다.

export interface RethumbResult { done: string[]; skipped: string[]; flows: number; errors: string[] }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function rethumbAll(host: Host, progress: (text: string) => Promise<void>): Promise<RethumbResult> {
  const store = new Store(host.kv);
  const state = store.state;
  const result: RethumbResult = { done: [], skipped: [], flows: 0, errors: [] };
  const skip = (label: string, reason: string) => result.skipped.push(`${label}: ${reason}`);
  const screens = [...state.screens.values()]
    .filter(s => s.status === 'active' && lastGui(state, s.id))
    .sort((a, b) => a.code.localeCompare(b.code));
  const made: { screen: Screen; record: GuiRecord; label: string; thumb: GuiThumb }[] = [];
  for (const [i, screen] of screens.entries()) {
    const label = formatFrameName(screen.code, screen.name);
    await progress(`${COPY.rethumb002} ${i + 1}/${screens.length}`);
    // 목록의 변경 감지(compare.ts)와 같은 기준·규칙으로 비교한다.
    const base = baseline(state, screen);
    const fpVersion = base?.fpVersion ?? 1;
    if (!screen.source) { skip(label, COPY.rethumb010); continue; }
    if (!base?.fingerprint) { skip(label, COPY.rethumb011); continue; }
    if (fpVersion !== FINGERPRINT_VERSION && fpVersion !== LEGACY_FINGERPRINT_VERSION) { skip(label, COPY.rethumb012); continue; }
    const legacy = fpVersion === LEGACY_FINGERPRINT_VERSION;
    const read = await host.fingerprint(screen.source.nodeId, legacy);
    if (read.error) { skip(label, read.error); continue; }
    if ((legacy ? read.legacyFingerprint : read.fingerprint) !== base.fingerprint) { skip(label, COPY.rethumb009); continue; }
    try { made.push({ screen, record: lastGui(state, screen.id)!, label, thumb: await host.makeThumbnail(screen.source.nodeId, label) }); }
    catch (e) { skip(label, `${COPY.rethumb014} ${message(e)}`); }
  }
  // 실행 중에 다른 사람이 새 버전을 배포했으면 그 화면의 새 썸네일을 덮지 않는다.
  const ready = made.filter(m => {
    const now = store.readFresh<Screen>(keys.screen(m.screen.id));
    if (now?.guiVersion === m.record.version && store.readFresh<GuiRecord>(keys.gui(m.screen.id, m.record.version))) return true;
    skip(m.label, COPY.rethumb013);
    return false;
  });
  if (!ready.length) return result;
  await progress(COPY.rethumb003);
  try { await host.placeThumbnails?.(ready.map(m => ({ screenId: m.screen.id, label: m.label, thumb: m.thumb }))); }
  catch (e) {
    result.errors.push(`${COPY.rethumb015} ${message(e)}`);
    return result;
  }
  const uids = new Set<string>();
  for (const m of ready) {
    const key = keys.gui(m.screen.id, m.record.version);
    const fresh = store.readFresh<GuiRecord>(key)!;
    store.put(key, { ...fresh, thumb: m.thumb });
    store.audit(host.actor, 'gui.thumb', key, fresh.thumb?.hash ?? null, m.thumb.hash, COPY.rethumb017);
    result.done.push(m.label);
    uids.add(m.screen.id);
  }
  if (host.updateFlow) {
    await progress(COPY.rethumb004);
    const { flows, thumbs } = flowUpdates(store.state, uids);
    for (const flow of flows) {
      try { if (await host.updateFlow(flow, thumbs, true)) result.flows++; }
      catch (e) { result.errors.push(`${COPY.rethumb016} ${flow.title}: ${message(e)}`); }
    }
  }
  return result;
}

// 진행과 결과만 보여 주는 작은 창. 문구는 본체에서 보내고 창은 textContent로만 쓴다.
const WINDOW_HTML = `<style>
body { margin: 0; padding: 12px 16px; font: 12px/1.5 Inter, system-ui, sans-serif; color: var(--figma-color-text); background: var(--figma-color-bg); }
h2 { font-size: 12px; margin: 12px 0 4px; } ul { margin: 0; padding-left: 16px; } button { margin-top: 16px; }
</style><div id="out"></div><script>
const out = document.getElementById('out');
const add = (tag, text, parent = out) => { const el = document.createElement(tag); el.textContent = text; parent.appendChild(el); return el; };
onmessage = e => {
  const m = e.data.pluginMessage;
  out.textContent = '';
  if (m.type === 'progress') { add('p', m.text); return; }
  for (const s of m.sections) {
    add('h2', s.title);
    if (s.items.length) { const ul = add('ul', ''); for (const t of s.items) add('li', t, ul); }
  }
  add('button', m.close).onclick = () => parent.postMessage({ pluginMessage: 'close' }, '*');
};
</script>`;

export async function runRethumb(host: Host): Promise<void> {
  figma.showUI(WINDOW_HTML, { width: 420, height: 360, themeColors: true, title: COPY.rethumb001 });
  figma.ui.onmessage = msg => { if (msg === 'close') figma.closePlugin(); };
  const progress = async (text: string) => {
    figma.ui.postMessage({ type: 'progress', text });
    // 이벤트 루프에 양보해야 진행 표시가 창에 전달된다.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  let sections: { title: string; items: string[] }[];
  try {
    const r = await rethumbAll(host, progress);
    sections = [
      { title: `${COPY.rethumb005} ${r.done.length}${COPY.rethumb008}`, items: r.done },
      { title: `${COPY.rethumb006} ${r.skipped.length}${COPY.rethumb008}`, items: r.skipped },
      { title: `${COPY.rethumb007} ${r.flows}${COPY.rethumb008}`, items: [] },
      ...(r.errors.length ? [{ title: COPY.rethumb019, items: r.errors }] : []),
    ];
  } catch (e) {
    sections = [{ title: COPY.rethumb019, items: [message(e)] }];
  }
  figma.ui.postMessage({ type: 'done', close: COPY.rethumb018, sections });
}
