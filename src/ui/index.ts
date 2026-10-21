import type { ToUi } from '../core/wire.ts';
import { startApp } from './app.ts';

startApp({
  send: message => parent.postMessage({ pluginMessage: message }, '*'),
  listen: handler => window.addEventListener('message', ev => {
    const message = ev.data?.pluginMessage as ToUi | undefined;
    if (message) handler(message);
  }),
}, document.getElementById('app')!);
