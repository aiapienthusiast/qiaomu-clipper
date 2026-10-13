// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ outdated: true, offline: false, send: vi.fn() }));
vi.mock('../utils/browser-polyfill', () => ({ default: {
 runtime: { id: 'fixture', getURL: (p: string) => p, sendMessage: state.send },
 storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
} }));
vi.mock('../utils/storage-utils', () => ({ generalSettings: { vaults: [] }, loadSettings: vi.fn(), saveSettings: vi.fn(), setLocalStorage: vi.fn(), getLocalStorage: vi.fn() }));
import { initializeLocalVaultSettings } from './general-settings';
const el = (id: string) => document.getElementById(id)!;
beforeEach(() => {
 document.body.innerHTML = readFileSync('src/settings.html', 'utf8');
 vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
 state.outdated = true; state.offline = false; state.send.mockReset();
 state.send.mockImplementation(async (m: any) => m.action === 'qiaomuAsr' ? state.outdated ? {ok:false,error:'helper-outdated'} : {ok:true} : m.action === 'qiaomuLocalStatus' ? state.offline ? {ok:false,reason:'Specified native messaging host not found.'} : {ok:true} : {ok:true,vaults:[]});
});
afterEach(() => vi.restoreAllMocks());
it('keeps the pkg visible when saving connects but subtitle support needs an update, and rechecks after installation', async () => {
 await initializeLocalVaultSettings();
 expect(el('local-helper-note').textContent).toContain('需要更新');
 expect(el('local-helper-help').hidden).toBe(false);
 expect(el('local-helper-download').hidden).toBe(false);
 expect((el('local-helper-download') as HTMLAnchorElement).href).toMatch(/latest\/download\/qiaomu-clipper-helper\.pkg$/);
 state.outdated = false; el('local-helper-recheck').click();
 await vi.waitFor(() => expect(el('local-helper-note').textContent).toContain('已连接'));
 expect(el('local-helper-help').hidden).toBe(false);
 expect(el('local-helper-download').hidden).toBe(false);
 expect(state.send.mock.calls.some(([m]) => m.payload?.mode === 'start')).toBe(false);
});
it('offers the pkg for a missing helper and keeps the download page for other platforms', async () => {
 state.offline = true; await initializeLocalVaultSettings();
 expect(el('local-helper-download').hidden).toBe(false);
 expect(el('local-helper-note').textContent).toContain('还没安装');
 vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
 await initializeLocalVaultSettings();
 expect(el('local-helper-download').hidden).toBe(true);
 expect(el('local-helper-more').hidden).toBe(false);
});
