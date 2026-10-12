import type { PanelSegment } from './youtube-panel-actions';

// A transcript that has been read once is kept, so reopening the video (or refreshing the page, when YouTube is slow to
// build its own transcript UI) shows it at once and study mode does not wait. Kept per video in extension storage,
// newest 30 only, and never an empty or oversized one.
export interface CacheStorage { get(keys: string | string[]): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
// v3 retains precise cue boundaries for player captions. Keep generated v2 results as a fallback to avoid repeating paid transcription.
const INDEX = 'qiaomuTranscriptIndex3';
const cacheKey = (id: string) => (id.startsWith('generated:') ? 'qiaomuTranscript2:' : 'qiaomuTranscript3:') + id;
const VALID_KEY = /^(?:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|generated:(?:youtube:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|xiaoyuzhou:[0-9a-f]{24}|file:[0-9a-f]{32}|rss:[0-9a-f]{12}:[0-9a-f]{16}|web:[0-9a-f]{12}))(?:#[a-z]{2,8})?$/;
export const CACHE_LIMIT = 30, MAX_BYTES = 800_000;

const valid = (value: unknown): value is PanelSegment[] => Array.isArray(value) && value.length > 0 && value.every(line => typeof line?.time === 'string' && typeof line?.text === 'string');

export function createTranscriptCache(storage: CacheStorage) {
	return {
		async read(videoId: string): Promise<PanelSegment[] | undefined> {
			try { const key = cacheKey(videoId); const value = (await storage.get(key))[key]; return valid(value?.segments) ? value.segments : undefined; } catch { return undefined; }
		},
		async write(videoId: string, segments: PanelSegment[]): Promise<void> {
			if (!VALID_KEY.test(videoId) || !valid(segments) || JSON.stringify(segments).length > MAX_BYTES) return;
			try {
				const index: Array<{ id: string; at: number }> = ((await storage.get(INDEX))[INDEX] as Array<{ id: string; at: number }> | undefined) || [];
				const next = [{ id: videoId, at: Date.now() }, ...index.filter(entry => entry.id !== videoId)];
				const drop = next.slice(CACHE_LIMIT);
				await storage.set({ [cacheKey(videoId)]: { segments, at: Date.now() }, [INDEX]: next.slice(0, CACHE_LIMIT) });
				if (drop.length) await storage.remove(drop.map(entry => cacheKey(entry.id)));
			} catch { /* a full or unavailable store only means no cache */ }
		},
	};
}
