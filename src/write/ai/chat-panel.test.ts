// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Editor } from '@tiptap/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const sent: { system: string; messages: { role: string; content: string }[] }[] = [];
let reply = '';
vi.mock('../../utils/chat-llm', () => ({
	enabledChatModels: () => [{ id: 'm1', name: 'Model One' }],
	streamChat: vi.fn(async (options: any) => { sent.push({ system: options.system, messages: options.messages }); for (const part of reply.match(/[\s\S]{1,20}/g) ?? []) options.onDelta(part); return reply; }),
}));
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));
vi.mock('../image-models', () => ({ loadImageModels: async () => ({ models: [], defaultId: '' }), readyModels: () => [], ASPECTS: [], labelOf: () => '', generateImage: async () => new Blob() }));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: async () => ({}) }, runtime: { getURL: (p: string) => p } } }));

import { resetDbConnection } from '../db';
import { buildExtensions } from '../editor/extensions';
import { editorMarkdown } from '../markdown-io';
import { mountChatPanel } from './chat-panel';
import { loadChat } from './chat-store';

const noRects = Object.assign([], { item: () => null });
(Range.prototype as any).getClientRects = () => noRects;
(Range.prototype as any).getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

let editor: Editor; let panel: ReturnType<typeof mountChatPanel>;
const titles: string[] = []; const digests: string[] = [];
beforeEach(() => {
	(globalThis as any).indexedDB = new IDBFactory(); resetDbConnection();
	sent.length = 0; titles.length = 0; digests.length = 0; document.body.textContent = '';
	editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: '# 小节\n\n第一段原文。\n\n第二段有一句重要的话。' });
	panel = mountChatPanel({ editor, articleId: 'art_1', getTitle: () => '旧标题', setTitle: t => titles.push(t), getDigest: () => '', setDigest: t => digests.push(t), getMarkdown: () => editorMarkdown(editor) });
});
afterEach(() => { panel.destroy(); editor.destroy(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const say = async (text: string) => { const input = document.querySelector<HTMLTextAreaElement>('.qw-chat-input')!; input.value = text; document.querySelector<HTMLButtonElement>('button[title="发送"]')!.click(); await settle(); };
const block = (json: unknown) => `\`\`\`qm-action\n${JSON.stringify(json)}\n\`\`\``;

it('answers about the article it can see and keeps the conversation', async () => {
	reply = '这篇文章的开头很直接。';
	await panel.toggle(true);
	expect(document.querySelectorAll('.qw-chip').length).toBe(4);
	await say('开头怎么样？');
	expect(sent[0].system).toContain('第二段有一句重要的话。');
	expect(sent[0].system).toContain('【文章标题】旧标题');
	expect(document.querySelector('.qw-msg.assistant')!.textContent).toContain('开头很直接');
	const stored = await loadChat('art_1');
	expect(stored[0].messages.map(m => m.role)).toEqual(['user', 'assistant']);
	expect(stored[0].title).toBe('开头怎么样？');
});

it('shows proposed edits as cards and applies each only when accepted', async () => {
	reply = `改动如下。\n${block({ type: 'replace', find: '重要的话', with: '关键的一句' })}\n${block({ type: 'setTitle', title: '新标题' })}\n${block({ type: 'insert', where: 'end', markdown: '## 结尾\n\n谢谢阅读。' })}`;
	await panel.toggle(true);
	await say('帮我改');
	expect(document.querySelectorAll('.qw-prop').length).toBe(3);
	expect(document.querySelector('.qw-msg.assistant .qw-msg-body')!.textContent!.trim()).toBe('改动如下。');
	expect(editorMarkdown(editor)).toContain('重要的话');
	const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-prop-apply'));
	buttons[0].click(); await settle();
	expect(editorMarkdown(editor)).toContain('关键的一句');
	expect(editorMarkdown(editor)).not.toContain('重要的话');
	buttons[1].click(); await settle();
	expect(titles).toEqual(['新标题']);
	buttons[2].click(); await settle();
	expect(editorMarkdown(editor).endsWith('谢谢阅读。')).toBe(true);
	expect(editor.getJSON().content!.some(n => n.type === 'heading' && (n.content?.[0] as any)?.text === '结尾')).toBe(true);
	expect(buttons.map(b => b.textContent)).toEqual(['已应用', '已应用', '已应用']);
	expect((await loadChat('art_1'))[0].messages[1].applied).toEqual([0, 1, 2]);
});

it('says so when quoted text is no longer in the article, and keeps the card usable', async () => {
	reply = block({ type: 'replace', find: '根本不存在的话', with: 'x' });
	await panel.toggle(true);
	await say('改一下');
	const button = document.querySelector<HTMLButtonElement>('.qw-prop-apply')!;
	button.click(); await settle();
	expect(button.disabled).toBe(false);
	expect(document.querySelector('.qw-toast')?.textContent).toContain('没在文章里找到');
});

it('does not offer pictures when no picture model is set up', async () => {
	reply = '好的';
	await panel.toggle(true);
	await say('配一张图');
	expect(sent[0].system).not.toContain('"type":"image"');
	expect(sent[0].system).toContain('还没有添加生图模型');
});
