import browser from '../../utils/browser-polyfill';
import { t } from '../../utils/ui-text';
import { h, toast } from '../editor/dom';
import type { ImageCredit } from '../types';
import { getImage } from '../images';
import { describeImageError } from './image-errors';
import { getImageJob, removeImageJob, restoreImageJobs, submitImageJob, subscribeImageJobs, watchImageJob, type ImageJob } from './image-jobs';
import { openGallery } from './image-gallery';
import { ASPECTS, loadImageModels, modelsOf, readyModels, serviceName, type ImageModelConfig } from '../image-models';
import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';

export { describeImageError };

export interface ImageApply { label: string; run: (imageId: string, prompt: string, credit?: ImageCredit) => void | Promise<void> }
export interface ImageDialogOptions { title?: string; prompt?: string; aspect?: string; autoRun?: boolean; applies: ImageApply[] }

export const openImageSettings = () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=image-models') }); };

// Describe a picture, pick a shape, look at the result, then decide where it goes.
export async function openImageDialog(options: ImageDialogOptions): Promise<void> {
	const store = await loadImageModels();
	const models = readyModels(store);
	const dialog = h('dialog', { class: 'qw-dialog qw-image-dialog', 'aria-label': options.title ?? t('AI 配图') });
	let url = '';
	let jobId = '';
	let unwatch = () => {};
	const unsubscribe = subscribeImageJobs(() => sync());
	// Closing never cancels a picture that is being made: it keeps going in the background and the writer is told when it is ready.
	const close = () => {
		unsubscribe(); unwatch();
		if (jobId && ['queued', 'running'].includes(getImageJob(jobId)?.state ?? '')) toast(t('配图已转到后台，完成后会提示你，也可以在图库里找到'));
		if (url) URL.revokeObjectURL(url);
		dialog.close(); dialog.remove();
	};
	void restoreImageJobs();
	const title = h('h2', { class: 'qw-dialog-title', text: options.title ?? t('AI 配图') });
	dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
	document.body.append(dialog);

	if (!models.length) {
		const go = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去添加生图模型') });
		go.addEventListener('click', () => { close(); openImageSettings(); });
		const cancel = h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: close });
		dialog.append(title, h('p', { class: 'qw-dialog-note', text: t('还没有可用的生图模型。添加一个以后，就能在这里生成配图和封面。') }), h('div', { class: 'qw-dialog-actions' }, cancel, go));
		dialog.showModal();
		return;
	}

	const prompt = h('textarea', { class: 'qw-field', rows: 4, placeholder: t('描述想要的画面、风格和构图'), spellcheck: false });
	prompt.value = options.prompt ?? '';
	const aspect = h('select', { class: 'qw-field', 'aria-label': t('画面比例') });
	for (const a of ASPECTS) aspect.append(h('option', { value: a, text: a }));
	aspect.value = options.aspect && (ASPECTS as readonly string[]).includes(options.aspect) ? options.aspect : '16:9';
	// Every model of every connected service, grouped by service; the last choice is remembered.
	const model = h('select', { class: 'qw-field', 'aria-label': t('生图模型') });
	const choices: { key: string; config: ImageModelConfig; modelId: string }[] = [];
	for (const config of models) {
		const group = h('optgroup', { label: serviceName(config) });
		for (const modelId of modelsOf(config)) { const key = `${config.id}\u0000${modelId}`; choices.push({ key, config, modelId }); group.append(h('option', { value: key, text: modelId })); }
		model.append(group);
	}
	const fallback = models.find(m => m.id === store.defaultId) ?? models[0];
	const remembered = String(await getLocalStorage('qiaomuWriteImageChoice') ?? '');
	model.value = choices.some(c => c.key === remembered) ? remembered : `${fallback.id}\u0000${fallback.model}`;
	const status = h('p', { class: 'qw-dialog-note', role: 'status', 'aria-live': 'polite' });
	const preview = h('div', { class: 'qw-image-preview', hidden: true });
	const generate = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('生成配图') });
	const cancel = h('button', { type: 'button', class: 'qw-btn', text: t('关闭'), onclick: close });
	const applies = options.applies.map(apply => { const b = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: apply.label, hidden: true }); return { apply, b }; });
	const gallery = h('button', { type: 'button', class: 'qw-btn', text: t('打开图库'), onclick: () => { close(); void openGallery({ applies: options.applies }); } });
	let shownImage = '';

	// Shows what the current job is doing; runs again whenever any job changes.
	function sync() {
		const job = jobId ? getImageJob(jobId) : undefined;
		if (!job) return;
		const active = job.state === 'queued' || job.state === 'running';
		generate.disabled = active;
		if (active) {
			generate.textContent = t('生成中…');
			status.textContent = job.state === 'queued' ? t('已排队。可以关闭这个窗口继续写作，图好了会提示你。') : t('通常需要十几秒到一分钟。可以关闭这个窗口继续写作，图好了会提示你。');
			return;
		}
		if (job.state === 'ready' && job.imageId) {
			generate.textContent = t('重新生成');
			status.textContent = '';
			if (shownImage !== job.imageId) void showResult(job);
			return;
		}
		generate.textContent = shownImage ? t('重新生成') : t('生成配图');
		status.textContent = job.state === 'interrupted' ? t('上次没有完成（页面被关闭了），再点一次就会重新生成') : describeImageError(job.error);
	}
	async function showResult(job: ImageJob) {
		shownImage = job.imageId!;
		const image = await getImage(job.imageId!);
		if (!image || !dialog.isConnected || jobId !== job.id) return;
		if (url) URL.revokeObjectURL(url);
		url = URL.createObjectURL(image.blob);
		preview.textContent = ''; preview.hidden = false;
		preview.append(h('img', { src: url, alt: job.prompt }));
		applies.forEach(({ b }) => { b.hidden = false; });
	}
	const run = () => {
		const text = prompt.value.trim();
		if (!text) { status.textContent = t('先写下想要的画面'); prompt.focus(); return; }
		const choice = choices.find(c => c.key === model.value) ?? choices[0];
		void setLocalStorage('qiaomuWriteImageChoice', choice.key);
		const previous = jobId; unwatch();
		const { job } = submitImageJob({ prompt: text, aspect: aspect.value, configId: choice.config.id, modelId: choice.modelId });
		if (previous && previous !== job.id && getImageJob(previous)?.state === 'failed') void removeImageJob(previous);
		jobId = job.id; unwatch = watchImageJob(job.id);
		applies.forEach(({ b }) => { b.hidden = true; });
		sync();
	};
	generate.addEventListener('click', run);
	for (const { apply, b } of applies) {
		b.addEventListener('click', async () => {
			const job = jobId ? getImageJob(jobId) : undefined;
			if (!job?.imageId) return;
			b.disabled = true;
			try { await apply.run(job.imageId, prompt.value.trim()); close(); }
			catch { toast(t('这张图片没能保存'), 'error'); b.disabled = false; }
		});
	}
	const row = h('div', { class: 'qw-image-row' }, aspect, choices.length > 1 ? model : null);
	dialog.append(title, prompt, row, status, preview, h('div', { class: 'qw-dialog-actions' }, cancel, gallery, generate, ...applies.map(({ b }) => b)));
	dialog.showModal();
	prompt.focus();
	if (options.autoRun && prompt.value.trim()) run();
}
