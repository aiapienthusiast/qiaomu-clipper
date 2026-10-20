import { t } from '../../utils/ui-text';

export function describeImageError(error: unknown): string {
	const text = String((error as Error)?.message ?? error);
	if (/account-unsupported/.test(text)) return t('ChatGPT 账号不能用来生图，请改用 Codex 账号');
	if (/account-denied/.test(text)) return t('Codex 登录已失效，或这个账号不能生图，请到设置里重新登录');
	if (/HTTP (401|403)/.test(text)) return t('服务拒绝了这把密钥：可能填错、已过期，或没有开通生图');
	if (/HTTP 429/.test(text)) return t('请求太频繁，或额度用完了，稍后再试');
	if (/HTTP 400/.test(text)) return t('服务拒绝了这次请求：{0}', [text.replace(/^HTTP 400:?\s*/, '').slice(0, 160) || t('描述可能不被接受')]);
	if (/empty-image/.test(text)) return t('服务没有返回图片，换个描述再试');
	if (/abort|timeout|timed out/i.test(text)) return t('等得太久了，已经取消');
	if (/not-ready/.test(text)) return t('这个生图模型还没填完整');
	return text.slice(0, 200);
}
