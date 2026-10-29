import type { ToUi } from '../core/wire.ts';
import { startApp } from './app.ts';

startApp({
  send: message => parent.postMessage({ pluginMessage: message }, '*'),
  listen: handler => window.addEventListener('message', ev => {
    const message = ev.data?.pluginMessage as ToUi | undefined;
    if (message) handler(message);
  }),
  // 창 밖에 놓으면 Figma가 본체에 drop 이벤트를 보낸다(figma.on('drop')).
  drop: (clientX, clientY, dropMetadata) => parent.postMessage({ pluginDrop: { clientX, clientY, items: [], dropMetadata } }, '*'),
}, document.getElementById('app')!);
