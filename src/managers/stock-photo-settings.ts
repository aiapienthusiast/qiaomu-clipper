import { t } from '../utils/ui-text';
import { h, toast } from '../write/editor/dom';
import { STOCK_PROVIDERS, loadStockKeys, saveStockKeys } from '../write/stock-photos';

// "Free photo libraries" in the settings: one key per library, so the writer can search and insert photos with the author credited.
export async function initializeStockPhotoSettings(root: HTMLElement): Promise<void> {
	const keys = await loadStockKeys();
	const section = h('div', { class: 'sp-section' }, h('h3', { class: 'sp-title', text: t('免费图库') }), h('p', { class: 'write-note', text: t('在写长文的图库里搜索免费照片并插入。需要你自己申请的免费密钥，只保存在这台电脑的浏览器里。插入时会自动附上作者和来源。') }));
	for (const provider of STOCK_PROVIDERS) {
		const input = h('input', { type: 'password', class: 'qw-field', autocomplete: 'off', spellcheck: false, value: keys[provider.id] ?? '', placeholder: t('粘贴密钥'), 'aria-label': `${provider.name} ${t('密钥')}` });
		const save = h('button', { type: 'button', class: 'write-btn', text: t('保存') });
		save.addEventListener('click', async () => {
			const value = input.value.trim();
			const next = await loadStockKeys();
			if (value) next[provider.id] = value; else delete next[provider.id];
			await saveStockKeys(next);
			toast(value ? t('已保存') : t('已清除'));
		});
		section.append(h('div', { class: 'sp-row' }, h('div', { class: 'sp-name' }, h('strong', { text: provider.name }), h('a', { href: provider.keyUrl, target: '_blank', rel: 'noopener noreferrer', text: t('获取密钥') })), input, save));
	}
	root.append(section);
}
