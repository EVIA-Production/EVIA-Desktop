import React from 'react';
import { createRoot } from 'react-dom/client';
import ListenView from '../../src/renderer/overlay/ListenView';
import AskView from '../../src/renderer/overlay/AskView';
import { i18n } from '../../src/renderer/i18n/i18n';

const handlers = new Map<string, Set<(...args: any[]) => void>>();
const emit = (event: string, value: any) => handlers.get(event)?.forEach(fn => fn(value));
const askMode = new URLSearchParams(location.search).get('view') === 'ask';
function resizePanel(height: number) {
  const panel = document.getElementById('panel')!;
  panel.style.height = `${height}px`;
  panel.dataset.requestedHeight = String(height);
  panel.dataset.heightHistory = `${panel.dataset.heightHistory || ''},${height}`;
}
localStorage.setItem('evia_language', 'de');
localStorage.setItem('evia_session_state', 'during');
localStorage.setItem('current_chat_id', '1');
i18n.setLanguage('de');
(window as any).evia = {
  demo: { isEnabled: async () => ({ enabled: !askMode }) },
  auth: { getToken: async () => askMode ? 'layout-fixture-only' : null },
  captureSession: { get: async () => ({ state: 'recording', chatId: '1', generation: 1 }) },
  liveTranscript: { set() {}, clear() {} },
  windows: { adjustAskHeight: resizePanel },
  ipc: {
    on(event: string, fn: (...args: any[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      if (!askMode && event === 'transcript-message') setTimeout(() => emit(event, { type: 'recording_started' }), 100);
    },
    off(event: string, fn: (...args: any[]) => void) { handlers.get(event)?.delete(fn); },
    send() {},
  },
};
(window as any).api = { listenView: { adjustWindowHeight(_: string, height: number) { resizePanel(height); } } };
window.fetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
createRoot(document.getElementById('panel')!).render(askMode ? <AskView language="de" /> : <ListenView />);
