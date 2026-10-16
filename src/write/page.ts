import { Editor } from '@tiptap/core';
import { Archive, ArrowLeft, Code, Download, Ellipsis, FileText, ImagePlus, ListTree, Send, Trash2 } from 'lucide';
import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { t } from '../utils/ui-text';
import { aiReady, runAi } from './editor/ai';
import { askConfirm, h, icon, toast } from './editor/dom';
import { buildExtensions } from './editor/extensions';
import type { EditorHost } from './editor/host';
import { RevisionConflict, countWords, duplicateArticle, getArticle, newOrBlankArticle, purgeOldTrash, restoreArticle, saveArticle, trashArticle } from './articles';
import { imageIdFromUrl, saveImage } from './images';
import { imageUrls, insertImageFiles, localizeRemoteImages, pickImageFiles } from './images-ui';
import { editorMarkdown, exportArticle, exportArticleZip, parseFrontMatter, safeFileName } from './markdown-io';
import { publishers } from './publish';
import type { Article } from './types';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = h('a', { href: url, download: name });
	document.body.append(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const readingMinutes = (words: number) => Math.max(1, Math.round(words / 300));

function notice(root: HTMLElement, title: string, body: string, ...actions: HTMLElement[]): void {
	root.textContent = '';
	root.append(h('div', { class: 'qw-notice' }, h('h1', { text: title }), h('p', { text: body }), h('div', { class: 'qw-dialog-actions', style: 'justify-content:center' }, ...actions)));
}

export const listUrl = () => browser.runtime.getURL('settings.html?section=write');

// Only one tab edits an article at a time; a second tab hands over to the first.
async function claimArticle(id: string): Promise<boolean> {
	if (!navigator.locks) return true;
	return new Promise<boolean>(resolve => {
		navigator.locks.request(`qiaomu-write:${id}`, { ifAvailable: true }, lock => {
			if (!lock) { resolve(false); return undefined; }
			resolve(true);
			return new Promise<void>(() => { /* held until this tab closes */ });
		}).catch(() => resolve(true));
	});
}

export async function startWritePage(root: HTMLElement): Promise<void> {
	await loadSettings();
	void purgeOldTrash().catch(() => {});
	const params = new URLSearchParams(location.search);
	let article: Article | undefined;
	const wanted = params.get('id');
	try {
		if (!wanted) { article = await newOrBlankArticle(); history.replaceState(null, '', `write.html?id=${article.id}`); }
		else article = await getArticle(wanted);
	} catch { notice(root, t('无法打开本地文章库'), t('浏览器没有给扩展存储空间，请重启浏览器后重试。')); return; }
	if (!article) { notice(root, t('找不到这篇文章'), t('它可能已被彻底删除。'), h('a', { class: 'qw-btn qw-btn-primary', href: listUrl(), text: t('回到文章列表') })); return; }
	if (!(await claimArticle(article.id))) {
		void browser.runtime.sendMessage({ action: 'qiaomuWriteFocus', id: article.id }).catch(() => {});
		notice(root, t('这篇文章正在另一个标签页里编辑'), t('同时编辑会互相覆盖，请到那个标签页继续写。'));
		return;
	}
	if (article.trashedAt) {
		const id = article.id;
		notice(root, t('这篇文章在回收站里'), t('恢复后才能继续编辑。'), h('button', { class: 'qw-btn qw-btn-primary', type: 'button', onclick: async () => { await restoreArticle(id); location.reload(); } }, t('恢复文章')), h('a', { class: 'qw-btn', href: listUrl() }, t('回到文章列表')));
		return;
	}
	mountEditor(root, article);
}

function mountEditor(root: HTMLElement, initial: Article): void {
	let article = initial;
	let state: SaveState = 'saved';
	let sourceMode = false;
	let lastSaved = JSON.stringify([article.title, article.markdown, article.author, article.digest, article.sourceUrl, article.coverImageId]);
	let timer: number | undefined;
	let saving: Promise<void> = Promise.resolve();
	let conflict = false;

	// ---- chrome -----------------------------------------------------------------------------------------------------------
	const status = h('span', { class: 'qw-status', role: 'status', 'aria-live': 'polite' });
	const outlineButton = h('button', { type: 'button', class: 'qw-btn icon is-on', title: t('大纲'), 'aria-label': t('大纲'), 'aria-pressed': 'true' }, icon(ListTree));
	const sourceButton = h('button', { type: 'button', class: 'qw-btn icon', title: t('Markdown 源码'), 'aria-label': t('Markdown 源码'), 'aria-pressed': 'false' }, icon(Code));
	const exportButton = h('button', { type: 'button', class: 'qw-btn', 'aria-haspopup': 'menu' }, icon(Download, 15), t('导出'));
	const moreButton = h('button', { type: 'button', class: 'qw-btn icon', title: t('更多'), 'aria-label': t('更多'), 'aria-haspopup': 'menu' }, icon(Ellipsis));
	const publishButton = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', 'aria-haspopup': 'menu' }, icon(Send, 15), t('发布'));
	const back = h('a', { class: 'qw-btn', href: listUrl() }, icon(ArrowLeft, 15), t('文章列表'));
	const top = h('header', { class: 'qw-top' }, back, status, h('span', { class: 'qw-spacer' }), outlineButton, sourceButton, exportButton, publishButton, moreButton);

	const banner = h('div', { class: 'qw-banner', role: 'alert', hidden: true });
	const cover = h('figure', { class: 'qw-cover', hidden: true });
	const title = h('textarea', { class: 'qw-title', rows: 1, placeholder: t('标题'), 'aria-label': t('标题'), spellcheck: false });
	title.value = article.title;

	const authorInput = h('input', { type: 'text', value: article.author, placeholder: t('署名，可不填') });
	const digestInput = h('textarea', { rows: 2, placeholder: t('一两句话的摘要，用于发布时的简介') });
	digestInput.value = article.digest;
	const sourceInput = h('input', { type: 'text', value: article.sourceUrl, placeholder: 'https://…' });
	const coverPick = h('button', { type: 'button', class: 'qw-btn' }, icon(ImagePlus, 15), t('选择封面图'));
	const meta = h('details', { class: 'qw-meta' }, h('summary', { text: t('文章信息：封面、署名、摘要、原文链接') }),
		h('div', { class: 'qw-meta-grid' }, h('label', {}, t('封面'), coverPick), h('label', {}, t('署名'), authorInput), h('label', {}, t('摘要'), digestInput), h('label', {}, t('原文链接'), sourceInput)));

	const mount = h('div', { class: 'qw-editor' });
	const sourceArea = h('textarea', { class: 'qw-source', hidden: true, spellcheck: false, 'aria-label': t('Markdown 源码') });
	const outline = h('aside', { class: 'qw-outline', 'aria-label': t('大纲') });
	const foot = h('footer', { class: 'qw-foot' });
	const doc = h('article', { class: 'qw-doc' }, cover, title, meta, mount, sourceArea);
	root.textContent = '';
	root.append(h('div', { class: 'qw-app' }, top, banner, h('div', { class: 'qw-layout' }, h('main', { class: 'qw-scroll' }, doc), outline), foot));

	// ---- editor -----------------------------------------------------------------------------------------------------------
	const host: EditorHost = {
		pickImages: () => pickImageFiles(editor),
		insertImageFiles,
		localizeImages: localizeRemoteImages,
		aiReady,
		runAi,
	};
	const editor: Editor = new Editor({
		element: mount,
		extensions: buildExtensions({ resolveImage: id => imageUrls.resolve(id), host, onSetCover: src => { const id = imageIdFromUrl(src); if (id) setCover(id); } }),
		content: article.markdown,
		editorProps: { attributes: { class: 'qw-prose', spellcheck: 'false', 'aria-label': t('正文') } },
		onUpdate: () => { changed(); renderOutline(); },
		onCreate: () => renderOutline(),
	});

	const currentMarkdown = () => (sourceMode ? sourceArea.value : editorMarkdown(editor));
	const snapshot = () => ({ title: title.value.replace(/\n/g, ' ').trim(), markdown: currentMarkdown(), author: authorInput.value.trim(), digest: digestInput.value.trim(), sourceUrl: sourceInput.value.trim(), coverImageId: article.coverImageId });

	// ---- saving -----------------------------------------------------------------------------------------------------------
	const showState = (next: SaveState) => {
		state = next;
		status.textContent = next === 'saved' ? t('已保存') : next === 'saving' ? t('保存中…') : next === 'dirty' ? t('未保存') : t('保存失败');
		status.classList.toggle('error', next === 'error');
	};
	const updateFooter = () => {
		const words = snapshotWords();
		foot.textContent = '';
		foot.append(h('span', { text: t('{0} 字', [words]) }), h('span', { text: t('约 {0} 分钟读完', [readingMinutes(words)]) }));
	};
	const snapshotWords = () => countWords(snapshot().markdown);
	const refreshTitle = () => { document.title = `${title.value.trim() || t('未命名文章')} · ${t('写长文')}`; };

	const saveNow = (): Promise<void> => {
		window.clearTimeout(timer);
		saving = saving.catch(() => {}).then(async () => {
			if (conflict) return;
			const fields = snapshot();
			const key = JSON.stringify([fields.title, fields.markdown, fields.author, fields.digest, fields.sourceUrl, fields.coverImageId]);
			if (key === lastSaved) { if (state !== 'saved') showState('saved'); return; }
			showState('saving');
			try {
				article = await saveArticle({ ...article, ...fields }, article.revision);
				lastSaved = key;
				showState(JSON.stringify(snapshotKey()) === key ? 'saved' : 'dirty');
				if (state === 'dirty') schedule();
			} catch (error) {
				if (error instanceof RevisionConflict) { conflict = true; showState('error'); showConflict(); return; }
				showState('error');
				toast(t('保存失败，内容还在编辑器里。请先导出备份，再重试。'), 'error');
			}
		});
		return saving;
	};
	const snapshotKey = () => { const s = snapshot(); return [s.title, s.markdown, s.author, s.digest, s.sourceUrl, s.coverImageId]; };
	const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void saveNow(), 800); };
	function changed() { if (conflict) return; showState('dirty'); schedule(); updateFooter(); }
	function showConflict() {
		banner.hidden = false; banner.textContent = '';
		banner.append(h('span', { text: t('这篇文章在别处被修改过，继续保存会覆盖它。') }), h('button', { type: 'button', class: 'qw-btn', onclick: () => location.reload() }, t('重新载入')));
	}
	const flush = () => { if (state === 'dirty' || state === 'saving') void saveNow(); };
	window.addEventListener('beforeunload', event => { if (state === 'dirty' || state === 'error') { flush(); event.preventDefault(); } });
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
	window.addEventListener('pagehide', flush);

	// ---- title ------------------------------------------------------------------------------------------------------------
	const sizeTitle = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
	title.addEventListener('input', () => { sizeTitle(); refreshTitle(); changed(); });
	title.addEventListener('keydown', event => {
		if (event.isComposing) return;
		if (event.key === 'Enter') { event.preventDefault(); editor.commands.focus('start'); }
	});
	for (const input of [authorInput, digestInput, sourceInput]) input.addEventListener('input', changed);

	// ---- cover ------------------------------------------------------------------------------------------------------------
	const renderCover = async () => {
		cover.textContent = '';
		cover.hidden = !article.coverImageId;
		coverPick.lastChild!.textContent = article.coverImageId ? t('更换封面图') : t('选择封面图');
		if (!article.coverImageId) return;
		const url = await imageUrls.resolve(article.coverImageId);
		if (!url) { cover.hidden = true; return; }
		cover.append(h('img', { src: url, alt: '' }), h('div', { class: 'qw-cover-actions' },
			h('button', { type: 'button', class: 'qw-btn', onclick: () => pickCover() }, t('更换')),
			h('button', { type: 'button', class: 'qw-btn', onclick: () => setCover('') }, t('移除'))));
	};
	function setCover(id: string) { article = { ...article, coverImageId: id }; void renderCover(); changed(); }
	function pickCover() {
		const input = h('input', { type: 'file', accept: 'image/*' });
		input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { setCover((await saveImage(file, file.name)).id); } catch { toast(t('这张图片没能保存'), 'error'); } });
		input.click();
	}
	coverPick.addEventListener('click', pickCover);

	// ---- outline ----------------------------------------------------------------------------------------------------------
	let outlineTimer: number | undefined;
	function renderOutline() {
		window.clearTimeout(outlineTimer);
		outlineTimer = window.setTimeout(() => {
			const items: { text: string; level: number; pos: number }[] = [];
			editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') items.push({ text: node.textContent, level: node.attrs.level, pos }); });
			outline.textContent = '';
			if (!items.length) return;
			outline.append(h('h2', { text: t('大纲') }));
			for (const item of items) {
				const button = h('button', { type: 'button', class: 'qw-outline-item', text: item.text || t('（空标题）') });
				button.style.paddingInlineStart = `${8 + (item.level - 1) * 12}px`;
				button.addEventListener('click', () => { editor.chain().focus().setTextSelection(item.pos + 1).scrollIntoView().run(); });
				outline.append(button);
			}
		}, 200);
	}
	outlineButton.addEventListener('click', () => {
		outline.hidden = !outline.hidden;
		outlineButton.classList.toggle('is-on', !outline.hidden);
		outlineButton.setAttribute('aria-pressed', String(!outline.hidden));
	});

	// ---- source mode ------------------------------------------------------------------------------------------------------
	sourceButton.addEventListener('click', () => {
		sourceMode = !sourceMode;
		sourceButton.classList.toggle('is-on', sourceMode);
		sourceButton.setAttribute('aria-pressed', String(sourceMode));
		if (sourceMode) {
			sourceArea.value = editorMarkdown(editor);
			mount.hidden = true; sourceArea.hidden = false;
			sourceArea.style.height = 'auto'; sourceArea.style.height = `${Math.max(sourceArea.scrollHeight, window.innerHeight * 0.6)}px`;
			sourceArea.focus();
		} else {
			editor.commands.setContent(sourceArea.value, { emitUpdate: false });
			sourceArea.hidden = true; mount.hidden = false;
			renderOutline(); editor.commands.focus();
			void localizeRemoteImages(editor, true);
		}
		updateFooter();
	});
	sourceArea.addEventListener('input', () => { sourceArea.style.height = 'auto'; sourceArea.style.height = `${Math.max(sourceArea.scrollHeight, window.innerHeight * 0.6)}px`; changed(); });

	// ---- menus ------------------------------------------------------------------------------------------------------------
	let openMenu: HTMLElement | null = null;
	const closeMenu = () => { openMenu?.remove(); openMenu = null; };
	document.addEventListener('mousedown', event => { if (openMenu && !openMenu.contains(event.target as Node) && !(event.target as HTMLElement).closest('[aria-haspopup]')) closeMenu(); }, true);
	document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
	const showMenu = (anchor: HTMLElement, rows: { label: string; hint?: string; ic?: Node; danger?: boolean; run: () => void | Promise<void> }[]) => {
		const wasOpen = openMenu; closeMenu(); if (wasOpen) return;
		const menu = h('div', { class: 'qw-menu', role: 'menu' });
		for (const row of rows) {
			const item = h('div', { class: `qw-menu-item${row.danger ? ' danger' : ''}`, role: 'menuitem', tabindex: 0 }, row.ic ? h('span', { class: 'qw-menu-icon' }, row.ic) : null, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: row.label }), row.hint ? h('span', { class: 'qw-menu-hint', text: row.hint }) : null));
			const run = () => { closeMenu(); void row.run(); };
			item.addEventListener('click', run);
			item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(); } });
			menu.append(item);
		}
		document.body.append(menu);
		const rect = anchor.getBoundingClientRect();
		menu.style.top = `${rect.bottom + 6}px`;
		menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth))}px`;
		openMenu = menu;
	};

	const exportCurrent = async (): Promise<Article> => { await saveNow(); return article; };
	exportButton.addEventListener('click', () => showMenu(exportButton, [
		{ label: t('导出 Markdown'), hint: t('图片会一起打包成文件夹'), ic: icon(FileText, 14), run: async () => {
			const current = await exportCurrent();
			const { markdown, images } = await exportArticle(current);
			const name = safeFileName(current.title);
			if (!images.length) { download(new Blob([markdown], { type: 'text/markdown' }), `${name}.md`); return; }
			download(await exportArticleZip([current]), `${name}.zip`);
		} },
		{ label: t('复制 Markdown'), hint: t('只复制文字，图片以 assets 路径表示'), ic: icon(Archive, 14), run: async () => {
			const { markdown } = await exportArticle(await exportCurrent());
			await navigator.clipboard.writeText(parseFrontMatter(markdown).markdown);
			toast(t('已复制 Markdown'));
		} },
	]));

	moreButton.addEventListener('click', () => showMenu(moreButton, [
		{ label: t('保存网络图片到本地'), hint: t('文章里来自网页的图片会存进本地文章库'), run: () => localizeRemoteImages(editor) },
		{ label: t('复制为新文章'), run: async () => { const copy = await duplicateArticle((await exportCurrent()).id); if (copy) window.open(`write.html?id=${copy.id}`, '_blank'); } },
		{ label: t('移到回收站'), danger: true, ic: icon(Trash2, 14), run: async () => {
			if (!(await askConfirm({ title: t('把这篇文章移到回收站？'), note: t('30 天内可以在文章列表里恢复。'), confirm: t('移到回收站'), cancel: t('取消'), danger: true }))) return;
			await saveNow(); await trashArticle(article.id); state = 'saved'; location.href = listUrl();
		} },
	]));

	publishButton.addEventListener('click', () => showMenu(publishButton, publishers.map(publisher => ({
		label: publisher.label(), hint: article.publishes[publisher.id] ? t('已于 {0} 发布过', [new Date(article.publishes[publisher.id]!.at).toLocaleDateString()]) : publisher.hint(),
		run: async () => { const current = await exportCurrent(); await publisher.run({ article: current, markdown: current.markdown, onRecorded: record => { article = { ...article, publishes: { ...article.publishes, [publisher.id]: record } }; } }); },
	}))));

	// ---- keyboard ---------------------------------------------------------------------------------------------------------
	document.addEventListener('keydown', event => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveNow().then(() => { if (state === 'saved') toast(t('已保存')); }); }
	});

	sizeTitle(); refreshTitle(); showState('saved'); updateFooter(); void renderCover();
	if (!article.title && !article.markdown) title.focus(); else editor.commands.focus('end');
	window.addEventListener('resize', sizeTitle);
}
