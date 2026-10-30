import type { ToUi } from '../core/wire.ts';
import { startApp } from './app.ts';

startApp({
  send: message => parent.postMessage({ pluginMessage: message }, '*'),
  listen: handler => {
    const receive = (ev: MessageEvent) => {
      const message = ev.data?.pluginMessage as ToUi | undefined;
      if (message) handler(message);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
  // 창 밖에 놓으면 Figma가 본체에 drop 이벤트를 보낸다(figma.on('drop')).
  drop: (clientX, clientY, dropMetadata) => parent.postMessage({ pluginDrop: { clientX, clientY, items: [], dropMetadata } }, '*'),
}, document.getElementById('app')!);
