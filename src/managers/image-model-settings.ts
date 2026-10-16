import { ImagePlus, Pencil, Star, Trash2 } from 'lucide';
import { t } from '../utils/ui-text';
import { askConfirm, h, icon, toast } from '../write/editor/dom';
import { IMAGE_SOURCES, isReady, loadImageModels, saveImageModels, type ImageModelConfig, type ImageModelStore } from '../write/image-models';
import { newId } from '../write/images';

// "Picture models" in the settings: the services that make pictures for articles and covers.
export async function initializeImageModelSettings(): Promise<void> {
	const root = document.getElementById('image-models-home');
	if (!root) return;
	let store: ImageModelStore = await loadImageModels();
	const list = h('div', { class: 'im-list', role: 'list' });
	const add = h('button', { type: 'button', class: 'write-btn write-btn-primary' }, icon(ImagePlus, 15), t('添加生图模型'));
	root.append(h('div', { class: 'im-bar' }, add), list, h('p', { class: 'write-note', text: t('密钥只保存在这台电脑的浏览器里，不会同步。生成图片时，你写的描述会发给你选的服务。') }));

	const persist = async () => { await saveImageModels(store); store = await loadImageModels(); render(); };

	function render() {
		list.textContent = '';
		if (!store.models.length) { list.append(h('div', { class: 'write-empty' }, h('p', { class: 'write-empty-title', text: t('还没有生图模型') }), h('p', { text: t('添加一个后，就能在写长文里让 AI 配图、生成封面。') }))); return; }
		for (const model of store.models) {
			const isDefault = model.id === store.defaultId;
			const source = IMAGE_SOURCES.find(s => s.id === model.sourceId);
			const buttons = h('div', { class: 'write-row-actions im-actions' });
			const mk = (label: string, ic: Node, run: () => void | Promise<void>, danger = false) => {
				const b = h('button', { type: 'button', class: `write-icon${danger ? ' danger' : ''}`, title: label, 'aria-label': label }, ic);
				b.addEventListener('click', () => { void Promise.resolve(run()); });
				buttons.append(b);
			};
			if (!isDefault) mk(t('设为默认'), icon(Star, 15), async () => { store.defaultId = model.id; await persist(); });
			mk(t('编辑'), icon(Pencil, 15), () => openDialog(model));
			mk(t('删除'), icon(Trash2, 15), async () => {
				if (!(await askConfirm({ title: t('删除这个生图模型？'), note: t('只删除这里保存的设置和密钥。'), confirm: t('删除'), cancel: t('取消'), danger: true }))) return;
				store.models = store.models.filter(m => m.id !== model.id); await persist();
			}, true);
			list.append(h('div', { class: 'write-row im-row', role: 'listitem' }, h('div', { class: 'write-row-main' },
				h('div', { class: 'write-info' }, h('div', { class: 'write-title' }, model.name.trim() || source?.name || model.engine, isDefault ? h('span', { class: 'write-badge im-default', text: t('默认') }) : null),
					h('div', { class: 'write-meta' }, h('span', { text: model.model }), isReady(model) ? null : h('span', { class: 'im-warn', text: t('还没填完整') })))), buttons));
		}
	}

	function openDialog(existing?: ImageModelConfig): void {
		let source = IMAGE_SOURCES.find(s => s.id === existing?.sourceId) ?? IMAGE_SOURCES[0];
		const dialog = h('dialog', { class: 'qw-dialog im-dialog', 'aria-label': existing ? t('编辑生图模型') : t('添加生图模型') });
		const cards = h('div', { class: 'im-sources', role: 'radiogroup', 'aria-label': t('服务商') });
		const key = h('input', { class: 'qw-field', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'API key' });
		const model = h('input', { class: 'qw-field', type: 'text', list: 'im-model-presets', spellcheck: false });
		const presets = h('datalist', { id: 'im-model-presets' });
		const base = h('input', { class: 'qw-field', type: 'text', spellcheck: false });
		const name = h('input', { class: 'qw-field', type: 'text', spellcheck: false, placeholder: t('不填就用「服务商 · 模型」') });
		const keyLink = h('a', { class: 'im-key-link', target: '_blank', rel: 'noopener noreferrer', text: t('获取密钥') });
		const error = h('p', { class: 'qw-dialog-note im-error', role: 'alert', hidden: true });
		key.value = existing?.apiKey ?? ''; model.value = existing?.model ?? ''; base.value = existing?.baseUrl ?? ''; name.value = existing?.name ?? '';
		const field = (label: string, input: HTMLElement, extra?: HTMLElement | null) => h('label', { class: 'im-field' }, h('span', { text: label }), input, extra);

		const pick = (next: typeof source, keepModel = false) => {
			source = next;
			cards.querySelectorAll('button').forEach(b => { const on = (b as HTMLElement).dataset.id === next.id; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
			presets.textContent = ''; for (const m of next.models) presets.append(h('option', { value: m.id, label: m.name ?? m.id }));
			if (!keepModel) model.value = next.models[0]?.id ?? '';
			base.placeholder = next.baseUrl || 'https://…/v1';
			keyLink.hidden = !next.keyUrl; if (next.keyUrl) keyLink.href = next.keyUrl;
		};
		for (const s of IMAGE_SOURCES) {
			const card = h('button', { type: 'button', class: 'im-source', role: 'radio', 'aria-checked': 'false', dataset: { id: s.id } }, h('span', { class: 'im-source-name', text: s.id === 'custom' ? t('自定义') : s.name }), h('span', { class: 'im-source-sub', text: s.id === 'custom' ? t('OpenAI 兼容 /images/generations') : s.sub }));
			card.addEventListener('click', () => pick(s));
			cards.append(card);
		}
		pick(source, !!existing);

		const save = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('保存') });
		const cancel = h('button', { type: 'button', class: 'qw-btn', text: t('取消') });
		const close = () => { dialog.close(); dialog.remove(); };
		cancel.addEventListener('click', close);
		dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
		save.addEventListener('click', async () => {
			const config: ImageModelConfig = { id: existing?.id ?? newId('imm_'), sourceId: source.id, engine: source.engine, name: name.value.trim(), baseUrl: base.value.trim(), apiKey: key.value.trim(), model: model.value.trim() };
			const problem = !config.model ? t('请填写模型名') : source.id === 'custom' && !config.baseUrl ? t('自定义服务需要填写接口地址') : !isReady({ ...config, baseUrl: config.baseUrl || source.baseUrl }) ? t('请填写密钥') : '';
			if (problem) { error.hidden = false; error.textContent = problem; return; }
			store.models = existing ? store.models.map(m => (m.id === existing.id ? config : m)) : [...store.models, config];
			if (!store.defaultId) store.defaultId = config.id;
			close(); await persist(); toast(t('已保存'));
		});
		dialog.append(h('h2', { class: 'qw-dialog-title', text: existing ? t('编辑生图模型') : t('添加生图模型') }), cards,
			field(t('密钥'), key, keyLink), field(t('模型'), model, presets), h('details', { class: 'im-advanced' }, h('summary', { text: t('更多设置') }), field(t('接口地址'), base), field(t('显示名称'), name)),
			error, h('div', { class: 'qw-dialog-actions' }, cancel, save));
		document.body.append(dialog);
		dialog.showModal();
		key.focus();
	}

	add.addEventListener('click', () => openDialog());
	render();
}
