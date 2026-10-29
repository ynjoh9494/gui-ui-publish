import { COPY } from '../core/copy.ts';
import { COLLAPSED_WINDOW, type ToMain } from '../core/wire.ts';
import type { Team } from '../core/types.ts';
import type { Bridge } from './app.ts';

export function windowCollapse(bridge: Bridge, root: HTMLElement, mode: () => Team): Bridge {
  let restore: Extract<ToMain, { type: 'resize' }> | null = null;
  let previousFocus: HTMLElement | null = null;
  const bar = document.createElement('div');
  bar.className = 'window-bar';
  const title = document.createElement('strong');
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/><path d="M15 3h6v6M21 3l-9 9"/></svg>';
  expand.title = COPY.windowExpand;
  expand.setAttribute('aria-label', COPY.windowExpand);
  bar.append(title, expand);
  root.append(bar);
  const unfold = () => {
    if (!restore) return;
    const size = restore;
    restore = null;
    root.classList.remove('window-collapsed');
    bridge.send({ ...size, save: false });
    previousFocus?.focus({ preventScroll: true });
  };
  expand.addEventListener('click', unfold);
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-action="collapse-window"]')) return;
    event.stopPropagation();
    if (restore) return;
    previousFocus = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    restore = { type: 'resize', width: root.offsetWidth, height: root.offsetHeight, compact: root.classList.contains('detail-collapsed') };
    title.textContent = mode() === 'UI' ? 'UI Flipbook' : 'GUI Publish';
    root.classList.add('window-collapsed');
    bridge.send({ type: 'resize', ...COLLAPSED_WINDOW, collapsed: true });
    expand.focus({ preventScroll: true });
  }, true);
  return {
    listen: handler => bridge.listen(handler),
    ...(bridge.drop ? { drop: (x: number, y: number, metadata: unknown) => bridge.drop!(x, y, metadata) } : {}),
    send(message) {
      if (restore && message.type === 'resize') { restore = { ...message, save: false }; return; }
      bridge.send(message);
    },
  };
}
