import { openDb, requestResult, transactionDone } from '../db';
import { generateImage, loadImageModels } from '../image-models';
import { newId, saveImage } from '../images';

// Picture-making runs here, not in the dialog: closing the window never loses a request.
// A paid request is never repeated on its own; failed or interrupted ones wait for the writer to press retry.
export type ImageJobState = 'queued' | 'running' | 'ready' | 'failed' | 'interrupted';
export interface ImageJob { id: string; prompt: string; aspect: string; configId: string; modelId: string; state: ImageJobState; error?: string; imageId?: string; createdAt: number; updatedAt: number }
export type ImageJobInput = Pick<ImageJob, 'prompt' | 'aspect' | 'configId' | 'modelId'>;

const MAX_PARALLEL = 2;
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
export const INTERRUPTED = 'interrupted';

const jobs = new Map<string, ImageJob>();
const controllers = new Map<string, AbortController>();
const watchers = new Map<string, number>();
const listeners = new Set<() => void>();
const doneListeners = new Set<(job: ImageJob) => void>();
let queue: string[] = [];
let running = 0;
let restored: Promise<void> | undefined;

const emit = () => listeners.forEach(fn => fn());
const keyOf = (job: ImageJobInput) => [job.prompt, job.aspect, job.configId, job.modelId].join('\u0000');
const isActive = (job: ImageJob) => job.state === 'queued' || job.state === 'running';

async function persist(job: ImageJob): Promise<void> {
	job.updatedAt = Date.now();
	try { const db = await openDb(); const tx = db.transaction('jobs', 'readwrite'); tx.objectStore('jobs').put({ ...job }); await transactionDone(tx); } catch { /* the job still runs; only the record after a restart is lost */ }
}
async function forget(id: string): Promise<void> {
	try { const db = await openDb(); const tx = db.transaction('jobs', 'readwrite'); tx.objectStore('jobs').delete(id); await transactionDone(tx); } catch { /* ignore */ }
}

// Called once when a page opens: whatever was still queued or running when the page closed did not finish.
export function restoreImageJobs(): Promise<void> {
	restored ??= (async () => {
		try {
			const db = await openDb();
			const saved = await requestResult(db.transaction('jobs').objectStore('jobs').getAll()) as ImageJob[];
			for (const job of saved) {
				if (jobs.has(job.id)) continue;
				if (job.state === 'ready' && Date.now() - job.updatedAt > KEEP_FINISHED_MS) { void forget(job.id); continue; }
				if (isActive(job)) { job.state = 'interrupted'; job.error = INTERRUPTED; void persist(job); }
				jobs.set(job.id, job);
			}
		} catch { /* no saved jobs */ }
		emit();
	})();
	return restored;
}

export const listImageJobs = (): ImageJob[] => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
export const activeImageJobCount = (): number => [...jobs.values()].filter(isActive).length;
export const getImageJob = (id: string): ImageJob | undefined => jobs.get(id);
export function subscribeImageJobs(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
// Told when a job ends (ready or failed) and nobody has the dialog for it open.
export function onImageJobEnd(fn: (job: ImageJob) => void): () => void { doneListeners.add(fn); return () => doneListeners.delete(fn); }
// A dialog that shows a job reports it, so the page does not announce the same result twice.
export function watchImageJob(id: string): () => void {
	watchers.set(id, (watchers.get(id) ?? 0) + 1);
	return () => { const left = (watchers.get(id) ?? 1) - 1; if (left > 0) watchers.set(id, left); else watchers.delete(id); };
}

// Asking for the same picture again while it is still being made gives back the running job instead of paying twice.
export function submitImageJob(input: ImageJobInput): { job: ImageJob; duplicate: boolean } {
	const same = [...jobs.values()].find(job => isActive(job) && keyOf(job) === keyOf(input));
	if (same) return { job: same, duplicate: true };
	const now = Date.now();
	const job: ImageJob = { ...input, id: newId('job_'), state: 'queued', createdAt: now, updatedAt: now };
	jobs.set(job.id, job);
	void persist(job);
	enqueue(job);
	return { job, duplicate: false };
}

export function retryImageJob(id: string): ImageJob | undefined {
	const job = jobs.get(id);
	if (!job || isActive(job) || job.state === 'ready') return job;
	const same = [...jobs.values()].find(other => other !== job && isActive(other) && keyOf(other) === keyOf(job));
	if (same) return same;
	job.state = 'queued'; job.error = undefined; job.imageId = undefined;
	void persist(job);
	enqueue(job);
	return job;
}

export async function removeImageJob(id: string): Promise<void> {
	const job = jobs.get(id);
	if (!job) return;
	queue = queue.filter(other => other !== id);
	controllers.get(id)?.abort();
	jobs.delete(id);
	await forget(id);
	emit();
}

function enqueue(job: ImageJob) { queue.push(job.id); emit(); pump(); }
function pump() {
	while (running < MAX_PARALLEL && queue.length) {
		const job = jobs.get(queue.shift()!);
		if (!job || job.state !== 'queued') continue;
		running++;
		void execute(job).finally(() => { running--; pump(); });
	}
}

async function execute(job: ImageJob): Promise<void> {
	const controller = new AbortController();
	controllers.set(job.id, controller);
	job.state = 'running'; emit(); void persist(job);
	try {
		const store = await loadImageModels();
		const config = store.models.find(model => model.id === job.configId);
		if (!config) throw new Error('not-ready');
		const blob = await generateImage(config, job.prompt, job.aspect, controller.signal, job.modelId);
		const image = await saveImage(blob, 'ai-image.png', { kept: true, prompt: job.prompt });
		if (!jobs.has(job.id)) return;
		job.imageId = image.id; job.state = 'ready';
	} catch (error) {
		if (!jobs.has(job.id)) return;
		job.state = 'failed'; job.error = String((error as Error)?.message ?? error);
	} finally {
		controllers.delete(job.id);
	}
	await persist(job);
	emit();
	if (!watchers.has(job.id)) doneListeners.forEach(fn => fn(job));
}

export function resetImageJobsForTests(): void {
	jobs.clear(); controllers.clear(); watchers.clear(); listeners.clear(); doneListeners.clear(); queue = []; running = 0; restored = undefined;
}
