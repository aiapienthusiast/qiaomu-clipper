import { getLocalStorage, setLocalStorage } from '../utils/storage-utils';

// Picture-making services the writer can call. Keys stay in this browser's local storage (never synced), like the speech-recognition keys.
export type ImageEngine = 'api' | 'ark' | 'gemini' | 'openrouter';
export interface ImageModelConfig { id: string; sourceId: string; engine: ImageEngine; name: string; baseUrl: string; apiKey: string; model: string }
export interface ImageModelStore { models: ImageModelConfig[]; defaultId: string }
export interface ImageSource { id: string; name: string; sub: string; engine: ImageEngine; baseUrl: string; keyUrl: string; models: { id: string; name?: string }[] }

export const IMAGE_SOURCES: ImageSource[] = [
	{ id: 'ark', name: '豆包 Seedream', sub: '火山方舟 · ark.cn-beijing.volces.com', engine: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
		models: [{ id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro' }, { id: 'doubao-seedream-5-0-flash-260915', name: 'Seedream 5.0 Flash' }, { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' }, { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' }] },
	{ id: 'gemini', name: 'Google Gemini 生图', sub: 'Nano Banana · generativelanguage.googleapis.com', engine: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', models: [{ id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' }] },
	{ id: 'openai', name: 'OpenAI', sub: 'api.openai.com', engine: 'api', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'gpt-image-1' }] },
	{ id: 'openrouter', name: 'OpenRouter', sub: 'openrouter.ai · 中转', engine: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', models: [{ id: 'google/gemini-2.5-flash-image' }, { id: 'bytedance-seed/seedream-4.5' }] },
	{ id: 'siliconflow', name: 'SiliconFlow', sub: 'FLUX 等 · api.siliconflow.cn', engine: 'api', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', models: [{ id: 'black-forest-labs/FLUX.1-schnell' }, { id: 'Qwen/Qwen-Image' }] },
	{ id: 'zhipu', name: '智谱 CogView', sub: 'open.bigmodel.cn', engine: 'api', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', models: [{ id: 'cogview-4' }] },
	{ id: 'custom', name: '自定义', sub: 'OpenAI 兼容 /images/generations', engine: 'api', baseUrl: '', keyUrl: '', models: [] },
];

const KEY = 'qiaomuImageModels';
export const ASPECTS = ['16:9', '4:3', '3:2', '1:1', '3:4', '2:3', '9:16', '21:9'] as const;
export type Aspect = typeof ASPECTS[number];

export function emptyStore(): ImageModelStore { return { models: [], defaultId: '' }; }

export function normalizeStore(raw: unknown): ImageModelStore {
	const value = (raw ?? {}) as Partial<ImageModelStore>;
	const models = (Array.isArray(value.models) ? value.models : []).filter((m): m is ImageModelConfig => !!m && typeof m.id === 'string' && typeof m.model === 'string' && ['api', 'ark', 'gemini', 'openrouter'].includes(m.engine))
		.map(m => ({ id: m.id, sourceId: String(m.sourceId || 'custom'), engine: m.engine, name: String(m.name || ''), baseUrl: String(m.baseUrl || '').trim(), apiKey: String(m.apiKey || '').trim(), model: m.model.trim() }));
	const defaultId = models.some(m => m.id === value.defaultId) ? String(value.defaultId) : models[0]?.id ?? '';
	return { models, defaultId };
}

export async function loadImageModels(): Promise<ImageModelStore> { return normalizeStore(await getLocalStorage(KEY)); }
export async function saveImageModels(store: ImageModelStore): Promise<void> { await setLocalStorage(KEY, normalizeStore(store)); }

export function isReady(model: ImageModelConfig): boolean {
	if (!model.model.trim()) return false;
	const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(model.baseUrl);
	if (model.engine === 'api') return !!model.baseUrl.trim() && (!!model.apiKey.trim() || local);
	return !!model.apiKey.trim();
}
export function labelOf(model: ImageModelConfig): string {
	const source = IMAGE_SOURCES.find(s => s.id === model.sourceId);
	return model.name.trim() || `${source ? source.name : model.engine} · ${model.model}`;
}
export function readyModels(store: ImageModelStore): ImageModelConfig[] { return store.models.filter(isReady); }

// ---- making a picture ---------------------------------------------------------------------------------------------------------
export function ratioOf(aspect: string): number { const [w, h] = aspect.split(':').map(Number); return w && h ? w / h : 1; }
export function openAiSize(aspect: string): '1024x1024' | '1536x1024' | '1024x1536' { const r = ratioOf(aspect); return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024'; }
// Seedream wants an explicit WxH of about 2K in total pixels (1K for the old 3.0 family), aspect between 1:16 and 16:1.
export function arkSize(model: string, aspect: string): string {
	const area = /seedream[-/.]3[-.]0/i.test(model) ? 1024 * 1024 : 2048 * 2048; const r = Math.min(16, Math.max(1 / 16, ratioOf(aspect)));
	return `${Math.round(Math.sqrt(area * r) / 8) * 8}x${Math.round(Math.sqrt(area / r) / 8) * 8}`;
}

const trimBase = (url: string) => url.trim().replace(/\/+$/, '');
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_WAIT_MS = 180000;

function fromBase64(b64: string, type = 'image/png'): Blob {
	const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: IMAGE_MIME.includes(type) ? type : bytes[0] === 0xff ? 'image/jpeg' : 'image/png' });
}
async function fromUrl(url: string, signal?: AbortSignal): Promise<Blob> {
	if (url.startsWith('data:')) { const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url); if (!m) throw new Error('empty-image'); return fromBase64(m[2], m[1]); }
	if (!/^https:\/\//i.test(url)) throw new Error('empty-image');
	const res = await fetch(url, { signal, credentials: 'omit' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const blob = await res.blob();
	return new Blob([blob], { type: IMAGE_MIME.includes(blob.type) ? blob.type : 'image/png' });
}

async function send(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
	const timeout = AbortSignal.timeout ? AbortSignal.timeout(MAX_WAIT_MS) : undefined;
	const combined = signal && timeout && (AbortSignal as any).any ? (AbortSignal as any).any([signal, timeout]) : signal ?? timeout;
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: combined, credentials: 'omit' });
	const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || json?.error) throw new Error(`HTTP ${res.status}${json?.error?.message ? `: ${String(json.error.message).slice(0, 200)}` : text && !json ? `: ${text.slice(0, 160)}` : ''}`);
	return json;
}

export function arkBody(model: string, prompt: string, aspect: string): Record<string, unknown> {
	return { model, prompt: `${prompt.trim()}\nImage aspect ratio: ${aspect}.`, size: arkSize(model, aspect), response_format: 'b64_json', watermark: false };
}

export async function generateImage(config: ImageModelConfig, prompt: string, aspect: string = '16:9', signal?: AbortSignal): Promise<Blob> {
	const text = prompt.trim();
	if (!text) throw new Error('empty-prompt');
	if (!isReady(config)) throw new Error('not-ready');
	const key = config.apiKey.trim();
	const source = IMAGE_SOURCES.find(s => s.id === config.sourceId);
	const base = trimBase(config.baseUrl || source?.baseUrl || '');
	if (config.engine === 'gemini') {
		const json = await send(`${base || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(config.model)}:generateContent`, { 'x-goog-api-key': key },
			{ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }, signal);
		const hit = (json?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
		if (!hit) throw new Error('empty-image');
		return fromBase64(hit.inlineData.data, hit.inlineData.mimeType);
	}
	if (config.engine === 'openrouter') {
		const headers = { Authorization: `Bearer ${key}` };
		const root = base || 'https://openrouter.ai/api/v1';
		try {
			const json = await send(`${root}/images`, headers, { model: config.model, prompt: text, n: 1, aspect_ratio: aspect, output_format: 'png' }, signal);
			const item = json?.data?.[0];
			if (item?.b64_json) return fromBase64(item.b64_json, item.media_type);
			if (item?.url) return await fromUrl(item.url, signal);
		} catch (error) { if (!/HTTP (404|405)/.test(String((error as Error).message))) throw error; }
		// Models that only speak chat completions return the picture inside the message.
		const json = await send(`${root}/chat/completions`, headers, { model: config.model, messages: [{ role: 'user', content: text }], modalities: ['image', 'text'], image_config: { aspect_ratio: aspect } }, signal);
		const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
		if (!url) throw new Error('empty-image');
		return await fromUrl(url, signal);
	}
	const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
	const body = config.engine === 'ark' ? arkBody(config.model, text, aspect) : { model: config.model, prompt: text, n: 1, size: openAiSize(aspect) };
	const json = await send(`${base || 'https://api.openai.com/v1'}/images/generations`, headers, body, signal);
	const item = json?.data?.[0] ?? json?.images?.[0];
	if (item?.b64_json) return fromBase64(item.b64_json);
	const url = item?.url;
	if (!url) throw new Error('empty-image');
	return await fromUrl(url, signal);
}
