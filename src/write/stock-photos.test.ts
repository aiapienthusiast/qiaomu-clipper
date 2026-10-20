// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../utils/storage-utils', () => ({ getLocalStorage: async (k: string) => store[k], setLocalStorage: async (k: string, v: unknown) => { store[k] = v; } }));

import { resetDbConnection } from './db';
import { getImage } from './images';
import { creditLine, importStockPhoto, loadStockKeys, saveStockKeys, searchStock } from './stock-photos';

const calls: { url: string; headers: any }[] = [];
const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['img'], { type: 'image/jpeg' }) });
beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); store = {}; calls.length = 0; });
const mockFetch = (body: unknown, status = 200) => { (globalThis as any).fetch = vi.fn(async (url: string, init: any) => { calls.push({ url, headers: init?.headers }); return respond(body, status); }); };

it('keeps keys per library and ignores blanks', async () => {
	await saveStockKeys({ unsplash: ' abc ', pexels: '' });
	expect(await loadStockKeys()).toEqual({ unsplash: 'abc' });
});

it('searches Unsplash with the key and credits the author with tracking links', async () => {
	mockFetch({ results: [{ id: 'u1', width: 10, height: 6, urls: { small: 's', regular: 'r' }, alt_description: 'a hill', user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } }, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/photos/u1/download' } }] });
	const [photo] = await searchStock('unsplash', 'K', 'hill', 2);
	expect(calls[0].url).toContain('search/photos?query=hill'); expect(calls[0].url).toContain('page=2'); expect(calls[0].headers.Authorization).toBe('Client-ID K');
	expect(photo.credit).toMatchObject({ provider: 'unsplash', author: 'Ann' }); expect(photo.credit.authorUrl).toContain('utm_source=qiaomu_clipper');
	expect(creditLine(photo.credit)).toBe('Photo by Ann on Unsplash');
});

it('reads Pexels and Pixabay, and maps bad keys and limits to plain errors', async () => {
	mockFetch({ photos: [{ id: 7, src: { medium: 'm', large2x: 'l' }, photographer: 'Bo', photographer_url: 'https://pexels.com/@bo', url: 'https://pexels.com/photo/7', alt: 'sea' }] });
	expect((await searchStock('pexels', 'P', '', 1))[0].credit).toMatchObject({ provider: 'pexels', author: 'Bo' });
	expect(calls[0].url).toContain('/curated'); expect(calls[0].headers.Authorization).toBe('P');
	mockFetch({ hits: [{ id: 9, webformatURL: 'w', largeImageURL: 'L', user: 'cy', user_id: 5, pageURL: 'https://pixabay.com/p/9', tags: 'a, b' }] });
	const [px] = await searchStock('pixabay', 'X', 'a');
	expect(px.credit.authorUrl).toBe('https://pixabay.com/users/cy-5/'); expect(calls[1].url).toContain('key=X');
	mockFetch({}, 401); await expect(searchStock('pixabay', 'X', 'a')).rejects.toThrow('stock-key');
	mockFetch({}, 429); await expect(searchStock('pexels', 'X', 'a')).rejects.toThrow('stock-limit');
});

it('saves the photo into the gallery with its credit and pings Unsplash once', async () => {
	mockFetch({ results: [{ id: 'u1', urls: { small: 's', regular: 'https://img/r.jpg' }, user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } }, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/photos/u1/download' } }] });
	const [photo] = await searchStock('unsplash', 'K', 'x');
	const image = await importStockPhoto(photo, 'K');
	expect((await getImage(image.id))).toMatchObject({ kept: true, credit: { author: 'Ann', provider: 'unsplash' } });
	expect(calls.some(c => c.url.endsWith('/download'))).toBe(true);
});
