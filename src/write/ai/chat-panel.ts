import type { Editor } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { History, MessageSquarePlus, Send, Sparkles, Square, X } from 'lucide';
import { enabledChatModels, streamChat } from '../../utils/chat-llm';
import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';
import { t } from '../../utils/ui-text';
import browser from '../../utils/browser-polyfill';
import { h, icon, toast } from '../editor/dom';
import { insertMarkdownAt, replaceWithMarkdown, textBlocks } from '../editor/markdown-insert';
import { loadImageModels, readyModels } from '../image-models';
import { imageUrlFor } from '../images';
import { loadChat, newSession, saveChat, titleOf, type ChatMessage, type ChatSession } from './chat-store';
import { openImageDialog } from './image-dialog';
import { MAX_ARTICLE_CHARS, buildSystemPrompt, findInBlocks, parseReply, quickPrompts, type AiProposal } from './protocol';

export interface ChatHost {
	editor: Editor;
	articleId: string;
	getTitle: () => string; setTitle: (title: string) => void;
	getDigest: () => string; setDigest: (text: string) => void;
	getMarkdown: () => string;
}

const MODEL_KEY = 'qiaomuChatModel';
const HISTORY_TURNS = 20;

function renderMarkdown(text: string): string {
	const html = marked.parse(text, { async: false, breaks: true }) as string;
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });
}

// The writer's AI partner: a drawer beside the article. It reads the article, answers, and proposes edits the writer accepts one by one.
export function mountChatPanel(host: ChatHost) {
	let sessions: ChatSession[] = [];
	let current: ChatSession = newSession();
	let controller: AbortController | undefined;
	let imageReady = false;
	let renderTimer = 0;

	const close = h('button', { type: 'button', class: 'qw-chat-btn', title: t('关闭'), 'aria-label': t('关闭') }, icon(X, 16));
	const fresh = h('button', { type: 'button', class: 'qw-chat-btn', title: t('新对话'), 'aria-label': t('新对话') }, icon(MessageSquarePlus, 16));
	const historyButton = h('button', { type: 'button', class: 'qw-chat-btn', title: t('历史对话'), 'aria-label': t('历史对话'), 'aria-haspopup': 'menu' }, icon(History, 16));
	const head = h('div', { class: 'qw-chat-head' }, h('span', { class: 'qw-chat-title' }, icon(Sparkles, 16), t('AI 助手')), h('span', { class: 'qw-spacer' }), historyButton, fresh, close);
	const list = h('div', { class: 'qw-chat-list', role: 'log', 'aria-live': 'polite' });
	const model = h('select', { class: 'qw-chat-model', 'aria-label': t('模型') });
	const input = h('textarea', { class: 'qw-chat-input', rows: 2, placeholder: t('问问 AI，或让它改文章…'), 'aria-label': t('给 AI 的话'), spellcheck: false });
	const send = h('button', { type: 'button', class: 'qw-chat-send', title: t('发送'), 'aria-label': t('发送') }, icon(Send, 16));
	const stop = h('button', { type: 'button', class: 'qw-chat-send', title: t('停止'), 'aria-label': t('停止'), hidden: true }, icon(Square, 14));
	const foot = h('div', { class: 'qw-chat-foot' }, h('div', { class: 'qw-chat-compose' }, input, send, stop), model);
	const panel = h('aside', { class: 'qw-chat', 'aria-label': t('AI 助手'), hidden: true }, head, list, foot);
	document.body.append(panel);

	const persist = () => { current.title = titleOf(current.messages); current.updatedAt = Date.now(); sessions = [current, ...sessions.filter(s => s.id !== current.id)]; void saveChat(host.articleId, sessions); };

	// ---- applying a proposal ------------------------------------------------------------------------------------------------
	const apply = async (proposal: AiProposal): Promise<boolean> => {
		const { editor } = host;
		switch (proposal.type) {
			case 'setTitle': host.setTitle(proposal.title); return true;
			case 'setDigest': host.setDigest(proposal.text); return true;
			case 'insert': insertMarkdownAt(editor, proposal.where, proposal.markdown); return true;
			case 'replace': {
				const range = findInBlocks(textBlocks(editor), proposal.find);
				if (!range) { toast(t('没在文章里找到这段话，可能已经改过了'), 'error'); return false; }
				replaceWithMarkdown(editor, range.from, range.to, proposal.with);
				return true;
			}
			case 'image': {
				void openImageDialog({ prompt: proposal.prompt, aspect: proposal.aspect, autoRun: true, applies: [{ label: t('插入文章'), run: id => { editor.commands.focus(); if (proposal.where === 'end') editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'image', attrs: { src: imageUrlFor(id), alt: proposal.prompt.slice(0, 80) } }).run(); else editor.chain().insertContent({ type: 'image', attrs: { src: imageUrlFor(id), alt: proposal.prompt.slice(0, 80) } }).run(); } }] });
				return false; // the card stays open: the picture is only applied once the writer picks it in the dialog
			}
		}
	};

	const describe = (proposal: AiProposal): { label: string; body: HTMLElement; action: string } => {
		switch (proposal.type) {
			case 'setTitle': return { label: t('改标题'), action: t('应用'), body: h('div', {}, h('div', { class: 'qw-prop-old', text: host.getTitle() || t('（还没有标题）') }), h('div', { class: 'qw-prop-new', text: proposal.title })) };
			case 'setDigest': return { label: t('写摘要'), action: t('应用'), body: h('div', { class: 'qw-prop-new', text: proposal.text }) };
			case 'insert': return { label: proposal.where === 'start' ? t('插入到开头') : proposal.where === 'end' ? t('插入到结尾') : t('插入到光标处'), action: t('插入'), body: h('div', { class: 'qw-prop-new', text: proposal.markdown.length > 400 ? `${proposal.markdown.slice(0, 400)}…` : proposal.markdown }) };
			case 'replace': return { label: t('替换这段话'), action: t('替换'), body: h('div', {}, h('div', { class: 'qw-prop-old', text: proposal.find }), h('div', { class: 'qw-prop-new', text: proposal.with || t('（删除）') })) };
			case 'image': return { label: t('生成配图'), action: t('生成并插入'), body: h('div', { class: 'qw-prop-new', text: `${proposal.prompt}（${proposal.aspect}）` }) };
		}
	};

	// ---- drawing the conversation -------------------------------------------------------------------------------------------
	const drawMessage = (message: ChatMessage, index: number, streaming: boolean): HTMLElement => {
		if (message.role === 'user') return h('div', { class: 'qw-msg user' }, h('div', { class: 'qw-bubble-text-user', text: message.content }));
		const parsed = parseReply(message.content);
		const body = h('div', { class: 'qw-msg-body' });
		if (parsed.text) body.innerHTML = renderMarkdown(parsed.text); // sanitised
		else if (streaming) body.append(h('span', { class: 'qw-typing', text: t('正在想…') }));
		body.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
		const out = h('div', { class: 'qw-msg assistant' }, body);
		const pendingIdx: number[] = [];
		parsed.proposals.forEach((proposal, i) => {
			const done = message.applied?.includes(i) ?? false;
			const info = describe(proposal);
			const button = h('button', { type: 'button', class: 'qw-btn qw-btn-primary qw-prop-apply', text: done ? t('已应用') : info.action, disabled: done || streaming });
			if (!done && proposal.type !== 'image') pendingIdx.push(i);
			button.addEventListener('click', async () => {
				if (!(await apply(proposal))) return;
				message.applied = [...(message.applied ?? []), i]; persist();
				button.textContent = t('已应用'); button.disabled = true;
			});
			out.append(h('div', { class: 'qw-prop' }, h('div', { class: 'qw-prop-head' }, h('span', { text: info.label }), button), info.body));
		});
		if (pendingIdx.length > 1 && !streaming) {
			const all = h('button', { type: 'button', class: 'qw-btn qw-prop-all', text: t('全部应用') });
			all.addEventListener('click', async () => { for (const i of pendingIdx) { if (await apply(parsed.proposals[i])) message.applied = [...(message.applied ?? []), i]; } persist(); draw(); });
			out.append(all);
		}
		if (!streaming) {
			const copy = h('button', { type: 'button', class: 'qw-msg-copy', text: t('复制') });
			copy.addEventListener('click', () => { void navigator.clipboard.writeText(parsed.text || message.content).then(() => { copy.textContent = t('已复制'); window.setTimeout(() => { copy.textContent = t('复制'); }, 1200); }); });
			out.append(copy);
		}
		void index;
		return out;
	};

	function draw(streaming = false) {
		const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
		list.textContent = '';
		if (!enabledChatModels().length) {
			const go = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去添加模型') });
			go.addEventListener('click', () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=interpreter') }); });
			list.append(h('div', { class: 'qw-chat-empty' }, h('p', { text: t('还没有可用的 AI 模型。添加一个以后，就能让它看你的文章、提意见、直接改。') }), go));
			return;
		}
		if (!current.messages.length) {
			list.append(h('div', { class: 'qw-chat-empty' }, h('p', { text: t('我能看到你正在写的文章。问我问题，或者让我改标题、写摘要、润色、配图。') }),
				h('div', { class: 'qw-chat-quick' }, ...quickPrompts().map(text => { const b = h('button', { type: 'button', class: 'qw-chip', text }); b.addEventListener('click', () => void ask(text)); return b; }))));
			return;
		}
		current.messages.forEach((message, i) => list.append(drawMessage(message, i, streaming && i === current.messages.length - 1)));
		if (atBottom || streaming) list.scrollTop = list.scrollHeight;
	}

	// ---- talking ------------------------------------------------------------------------------------------------------------
	const setBusy = (busy: boolean) => { send.hidden = busy; stop.hidden = !busy; input.disabled = busy; };
	async function ask(text: string) {
		const question = text.trim();
		const models = enabledChatModels();
		if (!question || !models.length || controller) return;
		const chosen = models.find(m => m.id === model.value) ?? models[0];
		void setLocalStorage(MODEL_KEY, chosen.id);
		const { editor } = host;
		const selection = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n');
		const headings: string[] = [];
		editor.state.doc.descendants(node => { if (node.type.name === 'heading') headings.push(node.textContent.trim()); return false; });
		const system = buildSystemPrompt({ title: host.getTitle(), digest: host.getDigest(), markdown: host.getMarkdown(), selection, headings, imageReady });
		current.messages.push({ role: 'user', content: question }, { role: 'assistant', content: '' });
		const reply = current.messages[current.messages.length - 1];
		const history = current.messages.slice(0, -1).slice(-HISTORY_TURNS).map(m => ({ role: m.role, content: m.content }));
		input.value = ''; resize();
		controller = new AbortController(); setBusy(true); draw(true);
		try {
			await streamChat({ model: chosen, system, messages: history, signal: controller.signal, onDelta: delta => { reply.content += delta; if (!renderTimer) renderTimer = requestAnimationFrame(() => { renderTimer = 0; draw(true); }); } });
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError') reply.content = reply.content ? `${reply.content}\n\n${t('（中断：{0}）', [String((error as Error)?.message ?? error).slice(0, 160)])}` : t('出错了：{0}', [String((error as Error)?.message ?? error).slice(0, 200)]);
		} finally {
			controller = undefined; setBusy(false);
			// A streaming redraw still queued would repaint the unfinished state over the final one.
			if (renderTimer) { cancelAnimationFrame(renderTimer); renderTimer = 0; }
			if (!reply.content.trim()) current.messages.splice(-2, 2); // nothing came back; do not keep an empty exchange
			persist(); draw(); input.focus();
		}
	}

	const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
	input.addEventListener('input', resize);
	input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void ask(input.value); } });
	send.addEventListener('click', () => void ask(input.value));
	stop.addEventListener('click', () => controller?.abort());
	fresh.addEventListener('click', () => { controller?.abort(); current = newSession(); draw(); input.focus(); });
	close.addEventListener('click', () => toggle(false));
	historyButton.addEventListener('click', () => {
		document.querySelector('.qw-chat-history')?.remove();
		if (!sessions.some(s => s.messages.length)) { toast(t('还没有历史对话')); return; }
		const menu = h('div', { class: 'qw-menu qw-chat-history', role: 'menu' });
		for (const s of sessions.filter(item => item.messages.length)) {
			const row = h('div', { class: `qw-menu-item${s.id === current.id ? ' active' : ''}`, role: 'menuitem', tabindex: 0 }, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: s.title || t('新对话') }), h('span', { class: 'qw-menu-hint', text: new Date(s.updatedAt).toLocaleString() })));
			row.addEventListener('click', () => { controller?.abort(); current = s; menu.remove(); draw(); });
			menu.append(row);
		}
		const rect = historyButton.getBoundingClientRect();
		menu.style.top = `${rect.bottom + 6}px`; menu.style.left = `${Math.max(8, rect.right - 260)}px`;
		document.body.append(menu);
		const away = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', away, true); } };
		document.addEventListener('mousedown', away, true);
	});

	async function refreshModels() {
		model.textContent = '';
		const models = enabledChatModels();
		for (const m of models) model.append(h('option', { value: m.id, text: m.name }));
		const saved = await getLocalStorage(MODEL_KEY);
		if (models.some(m => m.id === saved)) model.value = String(saved);
		model.hidden = models.length < 2;
		imageReady = readyModels(await loadImageModels()).length > 0;
	}

	async function toggle(open = panel.hidden) {
		panel.hidden = !open;
		document.body.classList.toggle('qw-chat-open', open);
		if (!open) return;
		await refreshModels();
		if (!sessions.length) { sessions = await loadChat(host.articleId); if (!current.messages.length && sessions[0]) current = sessions[0]; }
		draw(); input.focus();
	}
	return { toggle, isOpen: () => !panel.hidden, destroy: () => { controller?.abort(); panel.remove(); }, MAX_ARTICLE_CHARS };
}
