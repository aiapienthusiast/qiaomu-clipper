// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

let models: any[] = [];
const generate = vi.fn(async (_config: any, _prompt: string, _aspect: string) => new Blob(['png-bytes'], { type: 'image/png' }));
vi.mock('../image-models', () => ({
	ASPECTS: ['16:9', '1:1'], loadImageModels: async () => ({ models, defaultId: models[0]?.id ?? '' }), readyModels: (s: any) => s.models, labelOf: (m: any) => m.model,
	generateImage: (...args: [any, string, string]) => generate(...args),
}));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: vi.fn(async () => ({})) }, runtime: { getURL: (p: string) => p } } }));
(URL as any).createObjectURL = () => 'blob:fake'; (URL as any).revokeObjectURL = () => {};

import browser from '../../utils/browser-polyfill';
import { resetDbConnection } from '../db';
import { getImage } from '../images';
import { describeImageError, openImageDialog } from './image-dialog';

beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); document.body.textContent = ''; generate.mockClear(); models = [{ id: 'm', model: 'gpt-image-1' }]; if (!(HTMLDialogElement.prototype as any).showModal) { (HTMLDialogElement.prototype as any).showModal = function () { this.open = true; }; (HTMLDialogElement.prototype as any).close = function () { this.open = false; }; } });
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(b => b.textContent === label)!;

it('points to the settings when no picture model is set up', async () => {
	models = [];
	await openImageDialog({ applies: [] });
	expect(document.querySelector('dialog')!.textContent).toContain('还没有可用的生图模型');
	button('去添加生图模型').click();
	expect((browser.tabs.create as any)).toHaveBeenCalledWith({ url: 'settings.html?section=image-models' });
	expect(document.querySelector('dialog')).toBeNull();
});

it('makes a picture from the description and stores it only when the writer accepts it', async () => {
	const applied: { id: string; prompt: string }[] = [];
	await openImageDialog({ prompt: '雨后的山', aspect: '1:1', applies: [{ label: '插入文章', run: (id, prompt) => { applied.push({ id, prompt }); } }] });
	expect(button('插入文章').hidden).toBe(true);
	button('生成').click(); await settle();
	expect(generate).toHaveBeenCalledWith(models[0], '雨后的山', '1:1', expect.anything());
	expect(document.querySelector('.qw-image-preview img')).not.toBeNull();
	expect(button('插入文章').hidden).toBe(false);
	button('插入文章').click(); await settle();
	expect(applied.length).toBe(1);
	expect(applied[0].prompt).toBe('雨后的山');
	expect((await getImage(applied[0].id))?.mime).toBe('image/png');
	expect(document.querySelector('dialog')).toBeNull();
});

it('asks for a description first and explains failures in plain words', async () => {
	await openImageDialog({ applies: [] });
	button('生成').click(); await settle();
	expect(document.querySelector('dialog [role=status]')!.textContent).toContain('先写下想要的画面');
	expect(generate).not.toHaveBeenCalled();
	expect(describeImageError(new Error('HTTP 401'))).toContain('密钥无效');
	expect(describeImageError(new Error('HTTP 429'))).toContain('额度');
	expect(describeImageError(new Error('empty-image'))).toContain('没有返回图片');
	expect(describeImageError(new Error('HTTP 400: content policy'))).toContain('content policy');
});
