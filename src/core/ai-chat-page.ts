import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n, translatePage } from '../utils/i18n';
import { t } from '../utils/ui-text';
import { mountClipChat } from '../utils/clip-chat';
import { snapshotAiPage, parseAiPage, sameAiPage, type AiSnapshot } from '../utils/ai-page-context';

async function start() {
 await loadSettings(); await initializeI18n(); await translatePage();
 const params = new URLSearchParams(location.search);
 const tabId = Number(params.get('tab')), windowId = Number(params.get('window'));
 const expected = params.get('url') || '';
 const title = document.getElementById('ai-page-title')!;
 const status = document.getElementById('ai-page-status')!;
 const quoteButton = document.getElementById('ai-page-quote') as HTMLButtonElement;
 let disposed = false;
 window.addEventListener('pagehide', () => { disposed = true; });
 let context = { title: t('普通对话'), url: expected || `qiaomu-chat://tab/${tabId}`, markdown: '', available: false };
 async function refresh() {
  const tabs = await browser.tabs.query({ active: true, windowId });
  if (disposed || tabs[0]?.id !== tabId || !sameAiPage(expected, tabs[0]?.url || '')) throw new Error(t('页面已切换，请在当前页重新提问。'));
  let selection = '';
  context = { ...context, markdown: '', available: false };
  try {
   if (!/^https?:\/\//.test(expected)) throw new Error('Restricted');
   const results = await browser.scripting.executeScript({ target: { tabId }, func: snapshotAiPage });
   const snapshot = results[0]?.result as AiSnapshot | undefined;
   if (!snapshot || !sameAiPage(expected, snapshot.url)) throw new Error('Changed');
   const parsed = parseAiPage(snapshot); context = { ...parsed, available: Boolean(parsed.markdown) }; selection = snapshot.selection;
   status.textContent = context.markdown ? t('提问时会附上当前页正文。') : t('无法读取此页正文，可直接聊天或粘贴内容。');
  } catch {
   status.textContent = t('无法读取此页正文，可直接聊天或粘贴内容。');
  }
  const after = await browser.tabs.query({ active: true, windowId });
  if (disposed || after[0]?.id !== tabId || !sameAiPage(expected, after[0]?.url || '')) throw new Error(t('页面已切换，请在当前页重新提问。'));
  title.textContent = context.title; title.title = context.url;
  // Explicit absence prevents the model from pretending to have read a restricted page.
  if (!context.markdown) context.markdown = '[No page content is available. Do not claim to have read this page.]';
  return selection;
 }
 try { await refresh(); } catch { return; }
 if (disposed) return;
 const chat = mountClipChat({ getContext: () => context, prepareContext: async () => { await refresh(); }, onClose: () => parent.postMessage('close-ai-sidebar', location.origin) });
 chat.toggle(true);
 quoteButton.onclick = async () => {
  quoteButton.disabled = true;
  try { const selection = await refresh(); if (selection) chat.quote(selection); else status.textContent = t('请先在网页中选中文字。'); }
  catch (error) { status.textContent = String((error as Error).message); }
  finally { quoteButton.disabled = false; }
 };
}
void start();
