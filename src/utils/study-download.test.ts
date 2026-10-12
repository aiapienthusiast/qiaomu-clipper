// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const api=vi.hoisted(()=>({request:vi.fn(),download:vi.fn(),search:vi.fn(),getManifest:vi.fn()}));
vi.mock('./browser-polyfill',()=>({default:{ runtime:{getManifest:api.getManifest},permissions:{request:api.request},storage:{local:{get:async()=>({}),set:async()=>{}}},downloads:{download:api.download,search:api.search,onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}}}));
import {mountStudyDownload} from './study-download';
const source='https://x.com/author/status/1',media='https://video.twimg.com/test.mp4';
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
async function mount(over:Partial<Parameters<typeof mountStudyDownload>[2]>={}) {
 document.body.innerHTML='<article><div class="player-container"><video></video><div class="player-toggles"></div></div></article>';
 const article=document.querySelector('article')!,player=document.querySelector('video')!;
 await mountStudyDownload(article,player,{title:'Test',sourceUrl:source,mediaUrl:media,video:true,...over});return article;
}
beforeEach(()=>{vi.resetAllMocks();api.getManifest.mockReturnValue({optional_permissions:['downloads']});api.request.mockResolvedValue(true);api.download.mockResolvedValue(1);api.search.mockResolvedValue([{state:'complete'}]);vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([0,1,2]),{headers:{'content-type':'video/mp4'}})));vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();vi.restoreAllMocks();});
it('mounts a real player control and saves a non-YouTube file with optional permission',async()=>{
 const article=await mount();expect(article.querySelector('.qiaomu-dl-main')).not.toBeNull();article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();
 if(!__LOCAL_EDITION__) expect(api.request).toHaveBeenCalledWith({permissions:['downloads']});
 await flush();expect(fetch).toHaveBeenCalledWith(media,expect.objectContaining({redirect:__LOCAL_EDITION__?'follow':'error'}));expect(api.download).toHaveBeenCalled();expect(article.querySelector('.qiaomu-dl')?.getAttribute('data-state')).toBe('done');
});
it.skipIf(__LOCAL_EDITION__)('does not offer or request YouTube downloads',async()=>{for(const over of [{sourceUrl:'https://youtu.be/1'},{mediaUrl:'https://r1.googlevideo.com/videoplayback'}]){const article=await mount(over);expect(article.querySelector('.qiaomu-dl')).toBeNull();}expect(api.request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
it.skipIf(__LOCAL_EDITION__)('does not fetch when permission is denied',async()=>{api.request.mockResolvedValue(false);const article=await mount();article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(fetch).not.toHaveBeenCalled();expect(api.download).not.toHaveBeenCalled();expect(article.textContent).toContain('未获得下载权限');});
it('does not offer incomplete split streams or playlists',async()=>{for(const over of [{split:true},{mediaUrl:'https://cdn.example.org/master.m3u8'},{mediaUrl:'https://cdn.example.org/manifest.mpd'}]){const article=await mount(over);expect(article.querySelector('.qiaomu-dl')).toBeNull();}});
it('does not offer downloads on builds without the declared API permission',async()=>{api.getManifest.mockReturnValue({permissions:[]});expect((await mount()).querySelector('.qiaomu-dl')).toBeNull();});
it('checks encrypted media again at click time',async()=>{const article=await mount();Object.defineProperty(article.querySelector('video'),'mediaKeys',{value:{}});article.querySelector<HTMLButtonElement>('.qiaomu-dl-main')!.click();await flush();expect(fetch).not.toHaveBeenCalled();expect(api.download).not.toHaveBeenCalled();});
