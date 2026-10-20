import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n, translatePage } from '../utils/i18n';
import { t } from '../utils/ui-text';
import { mountClipChat } from '../utils/clip-chat';
import { snapshotAiPage, parseAiPage, sameAiPage, type AiSnapshot } from '../utils/ai-page-context';

async function start() {
	let disposed = false, refreshGeneration = 0;
	let chat: ReturnType<typeof mountClipChat> | undefined;
	const quoteButton = document.getElementById('ai-page-quote') as HTMLButtonElement;
	function dispose() {
		if (disposed) return;
		disposed = true;
		refreshGeneration++;
		quoteButton.onclick = null;
		chat?.destroy();
		window.removeEventListener('pagehide', dispose);
		window.removeEventListener('qiaomu-ai-dispose', dispose);
	}
	// Register before settings/i18n await: the parent can navigate during startup.
	window.addEventListener('pagehide', dispose);
	window.addEventListener('qiaomu-ai-dispose', dispose);
	await loadSettings();
	await initializeI18n();
	await translatePage();
	if (disposed) return;
	const params = new URLSearchParams(location.search);
	const tabId = Number(params.get('tab')), windowId = Number(params.get('window'));
	const expected = params.get('url') || '';
	const title = document.getElementById('ai-page-title')!;
	const status = document.getElementById('ai-page-status')!;
	let documentId: string | undefined;
	let context = { title: t('普通对话'), url: expected || `qiaomu-chat://tab/${tabId}`, markdown: '', available: false };
	const pageChanged = () => new Error(t('页面已切换，请在当前页重新提问。'));
	async function assertCurrent(generation: number) {
		const [tab] = await browser.tabs.query({ active: true, windowId });
		if (disposed || generation !== refreshGeneration || tab?.id !== tabId || tab.status === 'loading' || !sameAiPage(expected, tab.url || '')) throw pageChanged();
	}
	async function refresh() {
		const generation = ++refreshGeneration;
		await assertCurrent(generation);
		let snapshot: AiSnapshot | undefined;
		let snapshotDocument: string | undefined;
		if (/^https?:\/\//.test(expected)) {
			try {
				const [result] = await browser.scripting.executeScript({ target: { tabId }, func: snapshotAiPage });
				snapshot = result?.result as AiSnapshot | undefined;
				// Chrome 106+ supplies this field; the cross-browser polyfill types omit it.
				snapshotDocument = (result as { documentId?: string } | undefined)?.documentId;
			} catch { /* Missing host access: offer ordinary chat after rechecking the tab. */ }
		}
		// A different document is navigation, not a permission failure. Never reuse its history.
		if (snapshot && (!sameAiPage(expected, snapshot.url) || (documentId && snapshotDocument !== documentId))) throw pageChanged();
		const parsed = snapshot ? parseAiPage(snapshot) : { title: t('普通对话'), url: context.url, markdown: '' };
		await assertCurrent(generation);
		documentId = snapshotDocument || documentId;
		context = { ...parsed, available: Boolean(parsed.markdown) };
		title.textContent = context.title;
		title.title = context.url;
		status.textContent = context.available ? t('提问时会附上当前页正文。') : t('无法读取此页正文，可直接聊天或粘贴内容。');
		if (!context.markdown) context.markdown = '[No page content is available. Do not claim to have read this page.]';
		return snapshot?.selection || '';
	}
	try { await refresh(); } catch { dispose(); return; }
	if (disposed) return;
	chat = mountClipChat({
		getContext: () => context,
		prepareContext: async () => { await refresh(); },
		preserveUrlHash: true,
		onClose: () => { dispose(); parent.postMessage('close-ai-sidebar', location.origin); },
	});
	chat.toggle(true);
	quoteButton.onclick = async () => {
		quoteButton.disabled = true;
		try {
			const selection = await refresh();
			if (selection) chat?.quote(selection);
			else status.textContent = t('请先在网页中选中文字。');
		} catch (error) {
			if (!disposed) status.textContent = String((error as Error).message);
		} finally {
			if (!disposed) quoteButton.disabled = false;
		}
	};
}
void start();
