import { getLocalStorage, setLocalStorage } from '../utils/storage-utils';
import { fetchRemoteImage, saveImage } from './images';
import type { ImageCredit, StoredImage } from './types';

// Free photo libraries the writer can search. Each needs the writer's own free key, kept in this browser only (like the picture-model keys).
export type StockProvider = ImageCredit['provider'];
export interface StockProviderInfo { id: StockProvider; name: string; keyUrl: string; note: string }
export const STOCK_PROVIDERS: StockProviderInfo[] = [
	{ id: 'unsplash', name: 'Unsplash', keyUrl: 'https://unsplash.com/oauth/applications', note: '创建应用后复制 Access Key' },
	{ id: 'pexels', name: 'Pexels', keyUrl: 'https://www.pexels.com/api/new/', note: '申请后立即可用' },
	{ id: 'pixabay', name: 'Pixabay', keyUrl: 'https://pixabay.com/api/docs/', note: '登录后文档页里就有密钥' },
];
export interface StockPhoto { id: string; provider: StockProvider; thumb: string; full: string; width: number; height: number; description: string; credit: ImageCredit; download?: string }
export type StockKeys = Partial<Record<StockProvider, string>>;

const KEY = 'qiaomuStockPhotoKeys';
const UTM = 'utm_source=qiaomu_clipper&utm_medium=referral';
export const PAGE_SIZE = 24;

export async function loadStockKeys(): Promise<StockKeys> {
	const raw = (await getLocalStorage(KEY)) as StockKeys | undefined;
	const out: StockKeys = {};
	for (const p of STOCK_PROVIDERS) { const value = typeof raw?.[p.id] === 'string' ? raw[p.id]!.trim() : ''; if (value) out[p.id] = value; }
	return out;
}
export async function saveStockKeys(keys: StockKeys): Promise<void> { await setLocalStorage(KEY, keys); }

const withUtm = (url: string) => url + (url.includes('?') ? '&' : '?') + UTM;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
	const response = await fetch(url, { headers, credentials: 'omit' });
	if (response.status === 401 || response.status === 403) throw new Error('stock-key');
	if (response.status === 429) throw new Error('stock-limit');
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}

export async function searchStock(provider: StockProvider, key: string, query: string, page = 1): Promise<StockPhoto[]> {
	const q = encodeURIComponent(query.trim());
	if (provider === 'unsplash') {
		const headers = { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' };
		const data = await getJson(q ? `https://api.unsplash.com/search/photos?query=${q}&per_page=${PAGE_SIZE}&page=${page}` : `https://api.unsplash.com/photos?per_page=${PAGE_SIZE}&page=${page}&order_by=popular`, headers);
		return ((q ? data.results : data) as any[]).map(r => ({ id: String(r.id), provider, thumb: r.urls.small, full: r.urls.regular, width: r.width ?? 0, height: r.height ?? 0, description: r.alt_description ?? r.description ?? '',
			credit: { provider, author: r.user.name, authorUrl: withUtm(r.user.links.html), pageUrl: withUtm(r.links.html) }, download: r.links.download_location }));
	}
	if (provider === 'pexels') {
		const data = await getJson(q ? `https://api.pexels.com/v1/search?query=${q}&per_page=${PAGE_SIZE}&page=${page}` : `https://api.pexels.com/v1/curated?per_page=${PAGE_SIZE}&page=${page}`, { Authorization: key });
		return (data.photos as any[]).map(r => ({ id: String(r.id), provider, thumb: r.src.medium, full: r.src.large2x ?? r.src.large, width: r.width ?? 0, height: r.height ?? 0, description: r.alt ?? '',
			credit: { provider, author: r.photographer, authorUrl: r.photographer_url, pageUrl: r.url } }));
	}
	const data = await getJson(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo&safesearch=true&per_page=${PAGE_SIZE}&page=${page}`);
	return (data.hits as any[]).map(r => ({ id: String(r.id), provider, thumb: r.webformatURL, full: r.largeImageURL, width: r.imageWidth ?? 0, height: r.imageHeight ?? 0, description: r.tags ?? '',
		credit: { provider, author: r.user, authorUrl: `https://pixabay.com/users/${r.user}-${r.user_id}/`, pageUrl: r.pageURL } }));
}

// Saves the photo into the gallery with its credit. Unsplash asks to be told when a photo is used.
export async function importStockPhoto(photo: StockPhoto, key: string): Promise<StoredImage> {
	const blob = await fetchRemoteImage(photo.full);
	const image = await saveImage(blob, `${photo.credit.provider}-${photo.id}`, { kept: true, prompt: photo.description, credit: photo.credit });
	if (photo.download) void fetch(photo.download, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }, credentials: 'omit' }).catch(() => undefined);
	return image;
}

export const providerName = (id: StockProvider): string => STOCK_PROVIDERS.find(p => p.id === id)!.name;
// One line a reader sees under the picture.
export function creditLine(credit: ImageCredit): string { return `Photo by ${credit.author} on ${providerName(credit.provider)}`; }
