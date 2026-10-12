import browser from './browser-polyfill';
import { mountDownloadButton } from './download-button';
import { guessChoice, DownloadError } from './media-download';
import { canDownloadMedia } from './media-download-policy';
import { saveDownloadedBlob } from './browser-media-save';
import { t } from './ui-text';

export async function mountStudyDownload(article: HTMLElement, player: HTMLVideoElement, options: { title: string; sourceUrl: string; mediaUrl: string; video: boolean; split?: boolean }): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const declared = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes('downloads');
	if (!declared || player.mediaKeys || options.split || !canDownloadMedia(options.sourceUrl, options.mediaUrl)) return;
	const url = options.mediaUrl, video = options.video, name = options.title;
	const CHOICE_KEY = 'qiaomuDownloadChoice';
	const kind = guessChoice(url, video);
	const remembered = ((await browser.storage.local.get(CHOICE_KEY)) as Record<string, string | undefined>)[CHOICE_KEY];
	// An audio page keeps its controls in the player card; a video page has a row under the player: layout icons on the left,
	// the switches on the right (that row appears once the transcript is attached, and may be rebuilt), so follow it.
	const host = document.createElement('div'); host.className = 'qiaomu-dl-host';
	const place = () => {
		const card = article.querySelector<HTMLElement>('.player-container'), tools = article.querySelector<HTMLElement>('.qa-tools');
		const row = card?.querySelector<HTMLElement>(':scope > .player-toggles');
		const target = !video && tools ? tools : (row || card); if (!target) return;
		if (host.parentElement !== target) {
			host.style.cssText = target === card ? 'grid-column:2;grid-row:3;justify-self:end;padding:8px 0 0;line-height:normal' : target === tools ? 'margin-inline-start:auto' : 'display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;margin-inline-start:16px;line-height:normal';
			target.append(host);
		}
	};
	place(); if (!host.parentElement) return;
	const observer = new MutationObserver(place); observer.observe(article, { childList: true, subtree: true });
	const button = mountDownloadButton(host, {
		title: name, remembered, sourceUrl: options.sourceUrl,
		beforeDownload: async () => {
			if (player.mediaKeys || !canDownloadMedia(options.sourceUrl, url)) throw new DownloadError('policy', t('此来源不支持媒体下载'));
			if (!__LOCAL_EDITION__ && !await browser.permissions.request({ permissions: ['downloads'] })) throw new DownloadError('permission', t('未获得下载权限，请再次点击下载并允许。'));
		},
		choices: [{ id: kind.kind, label: video ? t('视频') : t('音频'), url, kind: kind.kind, ext: kind.ext }],
		onRemember: id => { void browser.storage.local.set({ [CHOICE_KEY]: id }); },
		save: saveDownloadedBlob,
	});
	const note = document.createElement('span'); note.className = 'qiaomu-dl-note'; note.textContent = t('仅下载你有权保存的内容'); note.style.cssText = 'margin-inline-start:8px;font-size:12px;color:var(--text-muted)'; host.append(note);
	window.addEventListener('pagehide', () => { observer.disconnect(); button.destroy(); }, { once: true });
}
