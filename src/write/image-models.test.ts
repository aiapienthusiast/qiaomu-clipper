import { beforeEach, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('../utils/storage-utils', () => ({ getLocalStorage: async (k: string) => store[k], setLocalStorage: async (k: string, v: unknown) => { store[k] = v; } }));
import { IMAGE_SOURCES, arkBody, arkSize, generateImage, isReady, labelOf, loadImageModels, normalizeStore, openAiSize, saveImageModels, type ImageModelConfig } from './image-models';

const model = (over: Partial<ImageModelConfig> = {}): ImageModelConfig => ({ id: 'a', sourceId: 'openai', engine: 'api', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-image-1', ...over });
const PNG_B64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
const calls: { url: string; init: any }[] = [];
const respond = (payload: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(payload), { status }); }));
beforeEach(() => { calls.length = 0; for (const k of Object.keys(store)) delete store[k]; vi.unstubAllGlobals(); });

it('keeps only usable saved models and falls back to the first as the default', async () => {
	await saveImageModels({ models: [model(), { ...model({ id: 'b' }), engine: 'bogus' as never }, { id: 'c' } as never], defaultId: 'zzz' });
	const loaded = await loadImageModels();
	expect(loaded.models.map(m => m.id)).toEqual(['a']);
	expect(loaded.defaultId).toBe('a');
	expect(normalizeStore(undefined)).toEqual({ models: [], defaultId: '' });
});

it('knows when a model can be called', () => {
	expect(isReady(model())).toBe(true);
	expect(isReady(model({ apiKey: '' }))).toBe(false);
	expect(isReady(model({ apiKey: '', baseUrl: 'http://localhost:8080/v1' }))).toBe(true);
	expect(isReady(model({ engine: 'ark', baseUrl: '', apiKey: 'k' }))).toBe(true);
	expect(isReady(model({ model: ' ' }))).toBe(false);
	expect(labelOf(model())).toBe('OpenAI · gpt-image-1');
	expect(labelOf(model({ name: '我的' }))).toBe('我的');
	expect(IMAGE_SOURCES.map(s => s.id)).toContain('siliconflow');
});

it('maps an aspect ratio to the sizes each service accepts', () => {
	expect(openAiSize('16:9')).toBe('1536x1024');
	expect(openAiSize('9:16')).toBe('1024x1536');
	expect(openAiSize('1:1')).toBe('1024x1024');
	expect(arkSize('doubao-seedream-5-0-pro-260628', '16:9')).toBe('2728x1536');
	expect(arkSize('doubao-seedream-3-0-t2i-250415', '1:1')).toBe('1024x1024');
	expect(arkBody('doubao-seedream-4-0-250828', '一只猫', '1:1')).toMatchObject({ size: '2048x2048', response_format: 'b64_json', watermark: false });
});

it('calls an OpenAI-compatible endpoint and returns the picture', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	const blob = await generateImage(model(), '山水', '16:9');
	expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
	expect(calls[0].init.headers.Authorization).toBe('Bearer sk-1');
	expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'gpt-image-1', prompt: '山水', size: '1536x1024', n: 1 });
	expect(blob.type).toBe('image/png');
	expect(blob.size).toBe(7);
});

it('talks to Seedream, Gemini and OpenRouter in their own ways', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	await generateImage(model({ engine: 'ark', sourceId: 'ark', baseUrl: '', model: 'doubao-seedream-5-0-pro-260628' }), 'x', '1:1');
	expect(calls[0].url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
	respond({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] });
	await generateImage(model({ engine: 'gemini', sourceId: 'gemini', baseUrl: '', model: 'gemini-2.5-flash-image' }), 'x', '3:4');
	expect(calls[1].url).toContain('/models/gemini-2.5-flash-image:generateContent');
	expect(calls[1].init.headers['x-goog-api-key']).toBe('sk-1');
	expect(JSON.parse(calls[1].init.body).generationConfig.imageConfig.aspectRatio).toBe('3:4');
	respond({ data: [{ b64_json: PNG_B64 }] });
	await generateImage(model({ engine: 'openrouter', sourceId: 'openrouter', baseUrl: '', model: 'google/gemini-2.5-flash-image' }), 'x', '1:1');
	expect(calls[2].url).toBe('https://openrouter.ai/api/v1/images');
});

it('reports the service error instead of an empty picture', async () => {
	respond({ error: { message: 'content policy' } }, 400);
	await expect(generateImage(model(), 'x')).rejects.toThrow(/HTTP 400: content policy/);
	respond({ data: [] });
	await expect(generateImage(model(), 'x')).rejects.toThrow('empty-image');
	await expect(generateImage(model({ apiKey: '' }), 'x')).rejects.toThrow('not-ready');
	await expect(generateImage(model(), '  ')).rejects.toThrow('empty-prompt');
});
