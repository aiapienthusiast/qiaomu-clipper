import { t } from '../../utils/ui-text';
import { askConfirm, h, toast } from '../editor/dom';
import { usedImageIds } from '../articles';
import { ImageUrlCache, deleteImages, listImages, updateImage } from '../images';
import type { ImageCredit, StoredImage } from '../types';
import browser from '../../utils/browser-polyfill';
import { PAGE_SIZE, STOCK_PROVIDERS, creditLine, importStockPhoto, loadStockKeys, providerName, searchStock, type StockPhoto, type StockProvider } from '../stock-photos';
import type { ImageApply } from './image-dialog';
import { describeImageError } from './image-errors';
import { listImageJobs, removeImageJob, restoreImageJobs, retryImageJob, subscribeImageJobs } from './image-jobs';

export interface GalleryOptions { applies: ImageApply[] }

const creditNode = (credit: ImageCredit): HTMLElement => h('p', { class: 'qw-gallery-prompt' }, 'Photo by ', h('a', { href: credit.authorUrl, target: '_blank', rel: 'noopener noreferrer', text: credit.author }), ' on ', h('a', { href: credit.pageUrl, target: '_blank', rel: 'noopener noreferrer', text: providerName(credit.provider) }));
const parseTags = (text: string): string[] => Array.from(new Set(text.split(/[,，、\s]+/).map(tag => tag.trim()).filter(Boolean))).slice(0, 12);
export const matchesImage = (image: StoredImage, query: string): boolean => {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [image.name, image.prompt ?? '', ...(image.tags ?? [])].some(text => text.toLowerCase().includes(needle));
};

// Every picture the writer has made or used: browse, search, rename, tag, delete, and put one back into the article.
export async function openGallery(options: GalleryOptions): Promise<void> {
	const dialog = h('dialog', { class: 'qw-dialog qw-gallery', 'aria-label': t('图库') });
	const urls = new ImageUrlCache();
	let images: StoredImage[] = [];
	let used = new Set<string>();
	let query = '';
	let selected = '';
	let closed = false;
	let mode: 'mine' | 'stock' = 'mine';
	const unsubscribe = subscribeImageJobs(() => { void refresh(); });
	const close = () => { closed = true; unsubscribe(); urls.revokeAll(); dialog.close(); dialog.remove(); };
	dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });

	const search = h('input', { type: 'search', class: 'qw-field', placeholder: t('搜索名称、描述或标签'), 'aria-label': t('搜索图库') });
	const tasks = h('div', { class: 'qw-gallery-tasks' });
	const grid = h('div', { class: 'qw-gallery-grid' });
	const detail = h('div', { class: 'qw-gallery-detail', hidden: true });
	const count = h('span', { class: 'qw-gallery-count', role: 'status', 'aria-live': 'polite' });
	const closeButton = h('button', { type: 'button', class: 'qw-btn', text: t('关闭'), onclick: close });
	search.addEventListener('input', () => { query = search.value; void drawGrid(); });
	const tabMine = h('button', { type: 'button', class: 'qw-btn', text: t('我的图片'), onclick: () => setMode('mine') });
	const tabStock = h('button', { type: 'button', class: 'qw-btn', text: t('免费图库'), onclick: () => setMode('stock') });
	const stock = h('div', { class: 'qw-gallery-stock', hidden: true });
	function setMode(next: 'mine' | 'stock') {
		mode = next;
		tabMine.classList.toggle('is-on', next === 'mine'); tabStock.classList.toggle('is-on', next === 'stock');
		tabMine.setAttribute('aria-pressed', String(next === 'mine')); tabStock.setAttribute('aria-pressed', String(next === 'stock'));
		for (const el of [search, grid, count]) el.hidden = next === 'stock';
		stock.hidden = next === 'mine';
		if (next === 'mine') { void refresh(); } else { detail.hidden = true; void drawStock(); }
	}
	const photoSearch = h('input', { type: 'search', class: 'qw-field', placeholder: t('搜索照片，留空看热门'), 'aria-label': t('搜索照片') });
	const providerSelect = h('select', { class: 'qw-field', 'aria-label': t('图库来源') });
	for (const p of STOCK_PROVIDERS) providerSelect.append(h('option', { value: p.id, text: p.name }));
	const photoGo = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('搜索') });
	const photoStatus = h('p', { class: 'qw-dialog-note', role: 'status', 'aria-live': 'polite' });
	const photoGrid = h('div', { class: 'qw-gallery-grid' });
	const photoMore = h('button', { type: 'button', class: 'qw-btn', text: t('加载更多'), hidden: true });
	const photoDetail = h('div', { class: 'qw-gallery-detail', hidden: true });
	stock.append(h('div', { class: 'qw-gallery-fields' }, providerSelect, photoSearch, photoGo), photoStatus, photoGrid, photoMore, photoDetail);
	let photos: StockPhoto[] = [];
	let photoPage = 1;
	let photoToken = 0;
	let chosen: StockPhoto | undefined;

	async function runSearch(more = false) {
		const provider = providerSelect.value as StockProvider;
		const key = (await loadStockKeys())[provider];
		photoPage = more ? photoPage + 1 : 1;
		if (!more) { photos = []; chosen = undefined; photoDetail.hidden = true; }
		photoGrid.textContent = ''; photoMore.hidden = true; photoStatus.textContent = '';
		if (!key) {
			photoStatus.textContent = t('还没有填写 {0} 的密钥。', [providerName(provider)]);
			photoStatus.append(' ', h('button', { type: 'button', class: 'qw-btn', text: t('去设置'), onclick: () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=image-models') }); } }));
			return;
		}
		const token = ++photoToken;
		photoGo.disabled = true; photoStatus.textContent = t('搜索中…');
		try {
			const found = await searchStock(provider, key, photoSearch.value, photoPage);
			if (token !== photoToken || closed) return;
			photos = more ? [...photos, ...found] : found;
			photoStatus.textContent = photos.length ? '' : t('没有找到照片');
			photoMore.hidden = found.length < PAGE_SIZE;
			drawPhotos();
		} catch (error) {
			if (token !== photoToken) return;
			const text = String((error as Error)?.message ?? error);
			photoStatus.textContent = text === 'stock-key' ? t('这个密钥不可用，请到设置里检查') : text === 'stock-limit' ? t('请求太频繁，稍后再试') : t('搜索失败：{0}', [text.slice(0, 120)]);
		} finally { if (token === photoToken) photoGo.disabled = false; }
	}
	function drawPhotos() {
		photoGrid.textContent = '';
		for (const photo of photos) {
			const tile = h('div', { class: `qw-gallery-tile${chosen === photo ? ' is-selected' : ''}`, role: 'button', tabindex: '0', 'aria-pressed': String(chosen === photo), 'aria-label': photo.description || creditLine(photo.credit) });
			tile.append(h('img', { src: photo.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('span', { class: 'qw-gallery-name', text: photo.credit.author }));
			const pick = () => { chosen = photo; drawPhotos(); drawPhotoDetail(); };
			tile.addEventListener('click', pick);
			tile.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
			photoGrid.append(tile);
		}
	}
	function drawPhotoDetail() {
		photoDetail.textContent = '';
		photoDetail.hidden = !chosen;
		if (!chosen) return;
		const photo = chosen;
		const credit = h('p', { class: 'qw-gallery-prompt' }, 'Photo by ', h('a', { href: photo.credit.authorUrl, target: '_blank', rel: 'noopener noreferrer', text: photo.credit.author }), ' on ', h('a', { href: photo.credit.pageUrl, target: '_blank', rel: 'noopener noreferrer', text: providerName(photo.credit.provider) }));
		const actions = h('div', { class: 'qw-gallery-actions' });
		const use = async (run: (image: StoredImage) => void | Promise<void>, button: HTMLButtonElement) => {
			button.disabled = true;
			try { const key = (await loadStockKeys())[photo.provider] ?? ''; await run(await importStockPhoto(photo, key)); }
			catch { toast(t('这张照片没能保存'), 'error'); button.disabled = false; }
		};
		for (const apply of options.applies) {
			const b = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: apply.label });
			b.addEventListener('click', () => void use(async image => { await apply.run(image.id, photo.description || creditLine(photo.credit), photo.credit); close(); }, b));
			actions.append(b);
		}
		const keep = h('button', { type: 'button', class: 'qw-btn', text: t('只存进图库') });
		keep.addEventListener('click', () => void use(() => { toast(t('已存进图库')); keep.disabled = false; }, keep));
		actions.append(keep);
		photoDetail.append(credit, actions);
	}
	async function drawStock() { if (!photos.length && !photoStatus.textContent) await runSearch(); }
	photoGo.addEventListener('click', () => void runSearch());
	photoSearch.addEventListener('keydown', event => { if (event.key === 'Enter' && !(event as KeyboardEvent).isComposing) { event.preventDefault(); void runSearch(); } });
	providerSelect.addEventListener('change', () => void runSearch());
	photoMore.addEventListener('click', () => void runSearch(true));

	function drawTasks() {
		tasks.textContent = '';
		const pending = listImageJobs().filter(job => job.state !== 'ready');
		tasks.hidden = !pending.length;
		for (const job of pending) {
			const state = job.state === 'queued' ? t('排队中') : job.state === 'running' ? t('生成中…') : job.state === 'interrupted' ? t('上次没有完成（页面被关闭了）') : describeImageError(job.error);
			const row = h('div', { class: `qw-gallery-task ${job.state}` }, h('div', { class: 'qw-gallery-task-text' }, h('strong', { text: job.prompt.slice(0, 60) }), h('span', { text: state })));
			if (job.state === 'failed' || job.state === 'interrupted') row.append(h('button', { type: 'button', class: 'qw-btn', text: t('重试'), onclick: () => { retryImageJob(job.id); } }));
			row.append(h('button', { type: 'button', class: 'qw-btn', text: job.state === 'queued' || job.state === 'running' ? t('取消') : t('移除'), onclick: () => { void removeImageJob(job.id); } }));
			tasks.append(row);
		}
	}

	async function drawGrid() {
		grid.textContent = '';
		const shown = images.filter(image => matchesImage(image, query));
		count.textContent = t('{0} 张图片', [shown.length]);
		if (!shown.length) { grid.append(h('p', { class: 'qw-gallery-empty', text: images.length ? t('没有找到图片') : t('这里还没有图片。生成配图或插入图片后，会出现在这里。') })); return; }
		for (const image of shown) {
			const tile = h('div', { class: `qw-gallery-tile${image.id === selected ? ' is-selected' : ''}`, role: 'button', tabindex: '0', 'aria-pressed': String(image.id === selected), 'aria-label': image.name || image.prompt || t('图片') });
			const img = h('img', { alt: '', loading: 'lazy' });
			void urls.resolve(image.id).then(url => { if (url && !closed) img.src = url; });
			tile.append(img, h('span', { class: 'qw-gallery-name', text: image.name || image.prompt?.slice(0, 30) || t('未命名') }));
			const pick = () => { selected = image.id; void drawGrid(); drawDetail(); };
			tile.addEventListener('click', pick);
			tile.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
			grid.append(tile);
		}
	}

	function drawDetail() {
		detail.textContent = '';
		const image = images.find(item => item.id === selected);
		detail.hidden = !image;
		if (!image) return;
		const name = h('input', { type: 'text', class: 'qw-field', value: image.name, 'aria-label': t('名称'), placeholder: t('名称') });
		const tags = h('input', { type: 'text', class: 'qw-field', value: (image.tags ?? []).join(' '), 'aria-label': t('标签'), placeholder: t('标签，用空格分隔') });
		const inUse = used.has(image.id);
		const actions = h('div', { class: 'qw-gallery-actions' });
		for (const apply of options.applies) actions.append(h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: apply.label, onclick: async () => { try { await apply.run(image.id, image.prompt || image.name, image.credit); close(); } catch { toast(t('这张图片没能保存'), 'error'); } } }));
		actions.append(h('button', { type: 'button', class: 'qw-btn', text: t('保存名称和标签'), onclick: async () => {
			const next = await updateImage(image.id, { name: name.value.trim().slice(0, 80), tags: parseTags(tags.value), kept: true });
			if (next) { images = images.map(item => item.id === next.id ? next : item); toast(t('已保存')); void drawGrid(); drawDetail(); }
		} }));
		const remove = h('button', { type: 'button', class: 'qw-btn qw-btn-danger', text: t('删除图片'), disabled: inUse, onclick: async () => {
			if (!await askConfirm({ title: t('删除这张图片？'), note: t('删除后无法恢复。'), confirm: t('删除'), cancel: t('取消'), danger: true })) return;
			await deleteImages([image.id]);
			images = images.filter(item => item.id !== image.id); selected = '';
			void drawGrid(); drawDetail();
		} });
		actions.append(remove);
		detail.append(h('div', { class: 'qw-gallery-fields' }, name, tags));
		if (image.credit) detail.append(creditNode(image.credit));
		if (image.prompt) detail.append(h('p', { class: 'qw-gallery-prompt', text: image.prompt }));
		if (inUse) detail.append(h('p', { class: 'qw-dialog-note', text: t('文章里正在用这张图片，先从文章里去掉才能删除。') }));
		detail.append(actions);
	}

	async function refresh() {
		if (closed || mode !== 'mine') return;
		[images, used] = await Promise.all([listImages(), usedImageIds()]);
		if (!images.some(image => image.id === selected)) selected = '';
		drawTasks(); void drawGrid(); drawDetail();
	}

	dialog.append(h('h2', { class: 'qw-dialog-title', text: t('图库') }), h('div', { class: 'qw-gallery-tabs' }, tabMine, tabStock), search, tasks, grid, detail, stock, h('div', { class: 'qw-dialog-actions' }, count, closeButton));
	document.body.append(dialog);
	dialog.showModal();
	setMode('mine');
	await restoreImageJobs();
	await refresh();
}
