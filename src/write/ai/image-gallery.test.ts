// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../image-models', () => ({ loadImageModels: async () => ({ models: [], defaultId: '' }), generateImage: async () => new Blob() }));
let keys: any = undefined;
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async () => keys, setLocalStorage: async () => {} }));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: vi.fn() }, runtime: { getURL: (p: string) => p } } }));
(URL as any).createObjectURL = () => 'blob:fake'; (URL as any).revokeObjectURL = () => {};

import { resetDbConnection } from '../db';
import { saveArticle, blankArticle } from '../articles';
import { listImages, saveImage } from '../images';
import { openGallery } from './image-gallery';
import { resetImageJobsForTests } from './image-jobs';

beforeEach(() => { keys = undefined; (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); resetImageJobsForTests(); document.body.textContent = ''; if (!(HTMLDialogElement.prototype as any).showModal) { (HTMLDialogElement.prototype as any).showModal = function () { this.open = true; }; (HTMLDialogElement.prototype as any).close = function () { this.open = false; }; } });
const settle = () => new Promise(resolve => setTimeout(resolve, 150));
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button'));

it('lists pictures, searches, edits name and tags, inserts, and refuses to delete a picture an article uses', async () => {
	const a = await saveImage(new Blob(['a'], { type: 'image/png' }), 'a.png', { kept: true, prompt: '雨后的山' });
	const b = await saveImage(new Blob(['b'], { type: 'image/png' }), 'b.png', { kept: true, prompt: '海边日落' });
	await saveArticle({ ...blankArticle(), markdown: `![x](qm-image://${b.id})` });
	const inserted: string[] = [];
	await openGallery({ applies: [{ label: '插入文章', run: id => { inserted.push(id); } }] });
	await settle();
	expect(document.querySelectorAll('.qw-gallery-tile').length).toBe(2);
	const search = document.querySelector<HTMLInputElement>('input[type=search]')!;
	search.value = '日落'; search.dispatchEvent(new Event('input')); await settle();
	expect(document.querySelectorAll('.qw-gallery-tile').length).toBe(1);
	document.querySelector<HTMLElement>('.qw-gallery-tile')!.click(); await settle();
	expect(buttons().find(x => x.textContent === '删除图片')!.disabled).toBe(true);
	search.value = ''; search.dispatchEvent(new Event('input')); await settle();
	document.querySelectorAll<HTMLElement>('.qw-gallery-tile').forEach(tile => { if (tile.getAttribute('aria-label') === 'a.png') tile.click(); }); await settle();
	expect(buttons().find(x => x.textContent === '删除图片')!.disabled).toBe(false);
	const [name, tags] = Array.from(document.querySelectorAll<HTMLInputElement>('.qw-gallery-fields input'));
	name.value = '山景'; tags.value = '风景 山'; buttons().find(x => x.textContent === '保存名称和标签')!.click(); await settle();
	expect((await listImages()).find(i => i.id === a.id)).toMatchObject({ name: '山景', tags: ['风景', '山'] });
	buttons().find(x => x.textContent === '插入文章')!.click(); await settle();
	expect(inserted).toEqual([a.id]);
	expect(document.querySelector('dialog')).toBeNull();
});

it('searches a free photo library and hands the author credit to the insert action', async () => {
	await openGallery({ applies: [{ label: '插入文章', run: (id, prompt, credit) => { inserted.push({ id, prompt, credit }); } }] });
	const inserted: any[] = [];
	await settle();
	buttons().find(x => x.textContent === '免费图库')!.click(); await settle();
	expect(document.querySelector('.qw-gallery-stock [role=status]')!.textContent).toContain('还没有填写 Unsplash 的密钥');
	keys = { unsplash: 'K' };
	(globalThis as any).fetch = vi.fn(async (url: string) => url.includes('api.unsplash.com') ? { ok: true, status: 200, json: async () => ({ results: [{ id: 'u1', urls: { small: 's', regular: 'https://img/r.jpg' }, alt_description: 'hill', user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } }, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/d' } }] }) } : { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
	const q = document.querySelector<HTMLInputElement>('.qw-gallery-stock input')!; q.value = 'hill';
	buttons().find(x => x.textContent === '搜索')!.click(); await settle();
	expect(document.querySelectorAll('.qw-gallery-stock .qw-gallery-tile').length).toBe(1);
	document.querySelector<HTMLElement>('.qw-gallery-stock .qw-gallery-tile')!.click(); await settle();
	expect(document.querySelector('.qw-gallery-stock .qw-gallery-detail a')!.getAttribute('href')).toContain('utm_source');
	const insert = Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-gallery-stock button')).find(x => x.textContent === '插入文章')!;
	insert.click(); await settle();
	expect(inserted[0].credit).toMatchObject({ author: 'Ann', provider: 'unsplash' });
	expect((await listImages()).some(i => i.credit?.author === 'Ann')).toBe(true);
});
