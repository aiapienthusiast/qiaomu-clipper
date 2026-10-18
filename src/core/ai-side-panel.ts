import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n } from '../utils/i18n';
import { t } from '../utils/ui-text';

// A fresh document per active page prevents a previous page's in-flight answer,
// selection, or context from crossing into the next page's conversation.
async function start() {
 await loadSettings(); await initializeI18n();
 const ownWindow = await browser.windows.getCurrent();
 const root = document.getElementById('ai-sidebar-root')!;
 let generation = 0, activeId: number | undefined;
 async function follow() {
  const request = ++generation;
  root.replaceChildren(); // Dispose old chat before any asynchronous tab lookup.
  const tabs = await browser.tabs.query({ active: true, windowId: ownWindow.id });
  if (request !== generation || !tabs[0]?.id) return;
  const tab = tabs[0]; activeId = tab.id;
  const frame = document.createElement('iframe');
  frame.title = t('AI 对话');
  const query = new URLSearchParams({ tab: String(tab.id), url: tab.url || '', window: String(ownWindow.id) });
  frame.src = browser.runtime.getURL('ai-chat-page.html?' + query);
  root.replaceChildren(frame);
 }
 browser.tabs.onActivated.addListener(info => { if (info.windowId === ownWindow.id) void follow(); });
 browser.tabs.onUpdated.addListener((id, change) => { if (id === activeId && (change.url || change.status === 'loading' || change.status === 'complete')) void follow(); });
 browser.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) void follow(); });
 window.addEventListener('message', event => {
  const frame = root.querySelector('iframe');
  if (event.source === frame?.contentWindow && event.origin === location.origin && event.data === 'close-ai-sidebar') window.close();
 });
 await follow();
}
void start();
