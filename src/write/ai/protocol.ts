import { t } from '../../utils/ui-text';

// The chat helper proposes changes as fenced ```qm-action blocks holding one JSON object each. Nothing is applied until the writer accepts.
export type AiProposal =
	| { type: 'setTitle'; title: string }
	| { type: 'setDigest'; text: string }
	| { type: 'insert'; where: 'cursor' | 'start' | 'end'; markdown: string }
	| { type: 'replace'; find: string; with: string }
	| { type: 'image'; prompt: string; where: 'cursor' | 'end'; aspect: string };

const FENCE = /```qm-action[^\S\n]*\n([\s\S]*?)```/g;
const ASPECTS = ['16:9', '4:3', '3:2', '1:1', '3:4', '2:3', '9:16', '21:9'];
const str = (value: unknown, max = 20000) => (typeof value === 'string' ? value.slice(0, max) : '');

export function normalizeProposal(raw: unknown): AiProposal | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const o = raw as Record<string, unknown>;
	switch (o.type) {
		case 'setTitle': { const title = str(o.title, 200).trim(); return title ? { type: 'setTitle', title } : undefined; }
		case 'setDigest': { const text = str(o.text, 1000).trim(); return text ? { type: 'setDigest', text } : undefined; }
		case 'insert': { const markdown = str(o.markdown).trim(); return markdown ? { type: 'insert', where: o.where === 'start' || o.where === 'end' ? o.where : 'cursor', markdown } : undefined; }
		case 'replace': { const find = str(o.find, 4000); const to = str(o.with ?? o.replace); return find.trim() ? { type: 'replace', find, with: to } : undefined; }
		case 'image': { const prompt = str(o.prompt, 2000).trim(); return prompt ? { type: 'image', prompt, where: o.where === 'end' ? 'end' : 'cursor', aspect: ASPECTS.includes(String(o.aspect)) ? String(o.aspect) : '16:9' } : undefined; }
		default: return undefined;
	}
}

// Splits a reply into what to show and what was proposed. A block still being written is held back until its closing fence arrives.
export function parseReply(text: string): { text: string; proposals: AiProposal[]; pending: boolean } {
	const proposals: AiProposal[] = [];
	let shown = text.replace(FENCE, (_whole, body: string) => {
		try { const proposal = normalizeProposal(JSON.parse(body.trim())); if (proposal) proposals.push(proposal); } catch { /* not valid JSON: dropped */ }
		return '';
	});
	const open = shown.indexOf('```qm-action');
	const pending = open >= 0;
	if (pending) shown = shown.slice(0, open);
	return { text: shown.replace(/\n{3,}/g, '\n\n').trim(), proposals, pending };
}

export interface ChatContext { title: string; digest: string; markdown: string; selection: string; headings: string[]; imageReady: boolean }
export const MAX_ARTICLE_CHARS = 12000;
export const MAX_SELECTION_CHARS = 3000;

export function buildSystemPrompt(ctx: ChatContext): string {
	const body = ctx.markdown.length > MAX_ARTICLE_CHARS ? `${ctx.markdown.slice(0, MAX_ARTICLE_CHARS)}\n\n（正文过长，只给出了前 ${MAX_ARTICLE_CHARS} 字）` : ctx.markdown;
	return [
		'你是乔木的写作搭档，在一个所见即所得的 Markdown 写作器里帮作者改文章。回答用作者使用的语言，直接、具体，不说客套话。',
		'作者问问题、要建议时，直接用文字回答。作者要你改文章时，不要直接贴整篇，而是用下面的指令块提出修改，作者会逐条决定是否应用。指令块之外用一两句话说明理由。',
		'指令块写法：三个反引号加 qm-action，换行后写一个 JSON 对象，再换行三个反引号。可以连续写多个指令块。可用的指令：',
		'{"type":"setTitle","title":"新标题"}',
		'{"type":"setDigest","text":"一两句话的摘要"}',
		'{"type":"insert","where":"cursor 或 start 或 end","markdown":"要插入的 Markdown"}',
		'{"type":"replace","find":"原文里要换掉的一段话，必须和原文逐字一致，且在同一个段落内","with":"替换后的内容"}',
		ctx.imageReady ? '{"type":"image","prompt":"配图的详细描述，说明画面、风格和构图，不要出现文字","where":"cursor 或 end","aspect":"16:9"}' : '（作者还没有添加生图模型，所以不要提出 image 指令；需要配图时提醒作者先在设置里添加生图模型。）',
		'replace 的 find 要尽量短而准确；改多处就写多个指令块。不要编造文章里没有的事实。',
		'',
		`【文章标题】${ctx.title.trim() || '（还没有标题）'}`,
		ctx.digest.trim() ? `【摘要】${ctx.digest.trim()}` : '',
		ctx.headings.length ? `【大纲】\n${ctx.headings.map(h => `- ${h}`).join('\n')}` : '',
		ctx.selection.trim() ? `【作者当前选中的文字】\n${ctx.selection.trim().slice(0, MAX_SELECTION_CHARS)}` : '',
		`【正文】\n${body.trim() || '（还没有正文）'}`,
	].filter(Boolean).join('\n');
}

export const quickPrompts = (): string[] => [
	t('帮我指出这篇文章最需要改进的三个地方。'),
	t('基于当前文章，给我 5 个更有吸引力但不标题党的标题。'),
	t('为当前文章生成一段自然、有信息量的中文摘要。'),
	t('根据当前文章生成一张适合正文的配图。'),
];

// Finds `needle` inside one paragraph of the article, so a proposed replacement lands exactly where it was meant.
export function findInBlocks(blocks: { start: number; text: string }[], needle: string): { from: number; to: number } | undefined {
	for (const block of blocks) {
		const index = block.text.indexOf(needle);
		if (index >= 0) return { from: block.start + index, to: block.start + index + needle.length };
	}
	const trimmed = needle.trim();
	if (trimmed && trimmed !== needle) return findInBlocks(blocks, trimmed);
	return undefined;
}
