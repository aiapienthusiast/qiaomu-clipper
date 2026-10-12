// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {mountStudyTips} from './study-tips';
const state=vi.hoisted(()=>({saved:false}));
vi.mock('./storage-utils',()=>({getLocalStorage:async()=>state.saved,setLocalStorage:async(_k:string,v:boolean)=>{state.saved=v;}}));
afterEach(()=>{state.saved=false;document.body.innerHTML='';vi.restoreAllMocks();});
it('cycles tips and remembers dismissal across remounts',async()=>{vi.spyOn(Math,'random').mockReturnValue(0);const stop=mountStudyTips(document.body);await Promise.resolve();const root=document.querySelector<HTMLElement>('.q-study-tips')!;expect(root.hidden).toBe(false);const text=root.querySelector('.q-study-tip-text')!;expect(text.textContent).toContain('10');root.querySelector<HTMLButtonElement>('button')!.click();expect(text.textContent).toContain('A');root.querySelectorAll<HTMLButtonElement>('button')[1].click();expect(root.hidden).toBe(true);stop();const stop2=mountStudyTips(document.body);await Promise.resolve();expect(document.querySelector<HTMLElement>('.q-study-tips')!.hidden).toBe(true);stop2();});
