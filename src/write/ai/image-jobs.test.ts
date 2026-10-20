// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

let release: (() => void)[] = [];
let fail = false;
const generate = vi.fn(() => new Promise<Blob>((resolve, reject) => { release.push(() => (fail ? reject(new Error('HTTP 429')) : resolve(new Blob([String(Math.random())], { type: 'image/png' })))); }));
vi.mock('../image-models', () => ({ loadImageModels: async () => ({ models: [{ id: 'm', model: 'x' }], defaultId: 'm' }), generateImage: (...args: unknown[]) => (generate as any)(...args) }));
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));

import { resetDbConnection } from '../db';
import { getImage, listImages, saveImage } from '../images';
import { collectUnusedImages } from '../articles';
import { getImageJob, listImageJobs, onImageJobEnd, removeImageJob, resetImageJobsForTests, restoreImageJobs, retryImageJob, submitImageJob, watchImageJob } from './image-jobs';
import { matchesImage } from './image-gallery';

const settle = () => new Promise(resolve => setTimeout(resolve, 150));
const input = { prompt: '山', aspect: '16:9', configId: 'm', modelId: 'x' };
beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); resetImageJobsForTests(); release = []; fail = false; generate.mockClear(); });

it('does not submit the same picture twice while it is being made, and runs two at a time', async () => {
	const a = submitImageJob(input); const dup = submitImageJob(input);
	expect(dup.duplicate).toBe(true); expect(dup.job.id).toBe(a.job.id);
	submitImageJob({ ...input, prompt: '海' }); submitImageJob({ ...input, prompt: '林' });
	await settle();
	expect(generate).toHaveBeenCalledTimes(2);
	expect(listImageJobs().map(j => j.state).sort()).toEqual(['queued', 'running', 'running']);
	release.shift()!(); await settle();
	expect(generate).toHaveBeenCalledTimes(3);
});

it('stores the result in the gallery, announces it once, and keeps it when no article uses it', async () => {
	const ended = vi.fn(); onImageJobEnd(ended);
	const { job } = submitImageJob(input); await settle(); release[0](); await settle();
	expect(getImageJob(job.id)!.state).toBe('ready');
	expect(ended).toHaveBeenCalledTimes(1);
	const image = await getImage(getImageJob(job.id)!.imageId!);
	expect(image).toMatchObject({ kept: true, prompt: '山' });
	expect(await collectUnusedImages()).toBe(0);
	expect(await getImage(image!.id)).toBeDefined();
});

it('stays quiet when a dialog is showing the job, and retries failures only on request', async () => {
	const ended = vi.fn(); onImageJobEnd(ended);
	fail = true;
	const { job } = submitImageJob(input); const unwatch = watchImageJob(job.id);
	await settle(); release[0](); await settle();
	expect(getImageJob(job.id)).toMatchObject({ state: 'failed', error: 'HTTP 429' });
	expect(ended).not.toHaveBeenCalled(); unwatch();
	expect(generate).toHaveBeenCalledTimes(1);
	fail = false; retryImageJob(job.id); await settle(); release[1](); await settle();
	expect(getImageJob(job.id)!.state).toBe('ready');
});

it('marks work that was cut off by closing the page as interrupted after reopening', async () => {
	const { job } = submitImageJob(input); await settle();
	resetImageJobsForTests();
	await restoreImageJobs();
	expect(getImageJob(job.id)).toMatchObject({ state: 'interrupted' });
	await removeImageJob(job.id);
	resetImageJobsForTests(); await restoreImageJobs();
	expect(listImageJobs()).toEqual([]);
});

it('finds pictures by name, description or tag', async () => {
	const image = await saveImage(new Blob(['a'], { type: 'image/png' }), '封面.png', { kept: true, prompt: 'Misty mountain', tags: ['山'] });
	expect(matchesImage(image, 'misty')).toBe(true); expect(matchesImage(image, '山')).toBe(true); expect(matchesImage(image, '封面')).toBe(true); expect(matchesImage(image, '海')).toBe(false);
	expect((await listImages()).length).toBe(1);
});
