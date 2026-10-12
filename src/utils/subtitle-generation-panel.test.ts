// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildGenerationPanel, type GenUi } from './subtitle-generation-panel';
import { generationStrings } from './subtitle-generation-strings';

it.each(['helper-offline', 'helper-outdated', 'cloud-not-configured', 'missing'] as const)('offers an actionable setup button for %s without restarting a job', reason => {
 const setup = vi.fn(), request = vi.fn();
 const panel = buildGenerationPanel(document, generationStrings((_, zh) => zh), { request, setup, confirm: vi.fn(), cancel: vi.fn() });
 panel.show({ kind: 'setup', reason, hints: [] });
 const buttons = panel.element.querySelectorAll('button');
 expect(buttons[0].textContent).toBe(reason.startsWith('helper-') ? '安装或更新本地助手' : '配置语音识别');
 buttons[0].click();
 expect(setup).toHaveBeenCalledWith(reason); expect(request).not.toHaveBeenCalled();
 expect(buttons[1].textContent).toBe('重新检查');
});
it('does not suggest installation or configuration while another task is busy', () => {
 const setup = vi.fn();
 const panel = buildGenerationPanel(document, generationStrings((_, zh) => zh), { request: vi.fn(), setup, confirm: vi.fn(), cancel: vi.fn() });
 panel.show({ kind: 'setup', reason: 'busy', hints: [] });
 expect(Array.from(panel.element.querySelectorAll('button')).map(b => b.textContent)).toEqual(['重新检查']);
 expect(setup).not.toHaveBeenCalled();
});

it('keeps the same dialog and focus while a selected model is checked, then updates installation in place', () => {
 document.body.innerHTML='';
 const panel = buildGenerationPanel(document, generationStrings((_, zh) => zh), {request:vi.fn(), confirm:vi.fn(), cancel:vi.fn(), choose:vi.fn()});
 const ui = {kind:'confirm' as const, modelDownload:false, selected:'local:mlx', choices:[{value:'local:mlx',label:'Whisper'}, {value:'local:qwen',label:'Qwen'}]};
 panel.show(ui);
 const dialog=document.querySelector<HTMLElement>('[role="dialog"]')!;
 const choice=dialog.querySelector<HTMLElement>('[data-value="local:qwen"]')!; choice.focus(); choice.click();
 panel.show({kind:'checking'});
 expect(document.querySelector('[role="dialog"]')).toBe(dialog);
 expect(dialog.querySelector<HTMLButtonElement>('.is-primary')!.disabled).toBe(true);
 panel.show({...ui, selected:'local:qwen', install:{name:'Qwen',sizeMb:500}});
 expect(document.querySelector('[role="dialog"]')).toBe(dialog);
 expect(document.activeElement).toBe(choice);
 expect(dialog.textContent).toContain('500 MB');
 expect(dialog.querySelector<HTMLButtonElement>('.is-primary')!.disabled).toBe(false);
 expect(dialog.querySelector('.is-primary')!.textContent).toBe('安装并生成字幕');
 panel.show(null);
});

it('changing a model stays in one dialog and one confirmation starts exactly one generation', async () => {
 const {createBarGeneration}=await import('./bar-generation');
 document.body.innerHTML='';
 let selected='mlx', finishChoice!: () => void;
 const start=vi.fn(async()=>({ok:true as const,id:'a'.repeat(32),videoKey:'youtube:abcdefghijk',state:'completed' as const,stage:'',progress:100,segments:[{start:0,end:1,text:'hello'}],next:1}));
 const choose=vi.fn(async (choice:any)=>{await new Promise<void>(resolve=>{finishChoice=resolve;});selected=choice.engine;return {ok:true as const} as any;});
 const status=vi.fn(async()=>({ok:true as const,ready:true,missing:[],hints:[],engine:selected,modelDownloadNeeded:false,local:['mlx','mlx-qwen3'].map(id=>({id,name:id,sizeMb:500,note:'',supported:true,installed:true,modelReady:true,managed:true})),choices:{mode:'local' as const,engine:selected,active:'',auto:true,profiles:[]}}));
 let panel:ReturnType<typeof buildGenerationPanel>;
 const gen=createBarGeneration({videoKey:()=> 'youtube:abcdefghijk',bar:()=>({setGeneration:(ui:GenUi|null)=>panel.show(ui)}) as any,apply:vi.fn(),revert:vi.fn(),save:vi.fn(),choose,deps:{status,start,poll:vi.fn(),cancel:vi.fn()}});
 panel=buildGenerationPanel(document,generationStrings((_,zh)=>zh),gen.actions);
 const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 gen.actions.regenerate!();await settle();
 const dialog=document.querySelector<HTMLElement>('[role="dialog"]')!;
 const language=dialog.querySelector<HTMLSelectElement>('select')!;language.value='en';language.dispatchEvent(new Event('change'));
 dialog.querySelector<HTMLElement>('[data-value="local:mlx-qwen3"]')!.click();
 expect(document.querySelector('[role="dialog"]')).toBe(dialog);expect(start).not.toHaveBeenCalled();
 expect(dialog.querySelector<HTMLButtonElement>('.is-primary')!.disabled).toBe(true);
 finishChoice();await settle();
 expect(document.querySelector('[role="dialog"]')).toBe(dialog);expect(language.value).toBe('en');
 expect(dialog.querySelector('[aria-checked="true"][role="radio"]')?.getAttribute('data-value')).toBe('local:mlx-qwen3');
 dialog.querySelector<HTMLButtonElement>('.is-primary')!.click();await settle();
 expect(start).toHaveBeenCalledExactlyOnceWith('youtube:abcdefghijk','en',true);
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 gen.reset();
});
