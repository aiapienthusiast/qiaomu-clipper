// @vitest-environment jsdom
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { mountEmbeddedPlayerInteraction } from './embedded-player-interaction';
let stop=()=>{};const origin='chrome-extension://mock-id';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>{stop();stop=()=>{};vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
function setup(ancestor=origin){
 document.body.innerHTML='<video></video><div class="ytp-chrome-bottom"></div><div class="ytp-settings-menu" hidden></div>';
 const original=window,parent={postMessage:vi.fn()},scope=Object.create(original);Object.defineProperties(scope,{top:{value:{}},parent:{value:parent},addEventListener:{value:original.addEventListener.bind(original)},removeEventListener:{value:original.removeEventListener.bind(original)},location:{value:{ancestorOrigins:[ancestor]}}});vi.stubGlobal('window',scope);vi.stubGlobal('location',scope.location);
 const video=document.querySelector('video')!;video.currentTime=12;video.playbackRate=1.25;
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,100,40));
 const send=(data:unknown,source=parent,from=origin)=>original.dispatchEvent(new MessageEvent('message',{data,origin:from,source:source as any}));return{parent,video,send};
}
it('does not activate in another site’s embed',()=>{const {parent}=setup('https://example.com');stop=mountEmbeddedPlayerInteraction('youtube');vi.advanceTimersByTime(500);expect(parent.postMessage).not.toHaveBeenCalled();});
it('reports native menu visibility and actual playback, then stops reporting on cleanup',()=>{const {parent}=setup();stop=mountEmbeddedPlayerInteraction('youtube');expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({time:12,rate:1.25,menuOpen:false,controlsVisible:true}),origin);document.querySelector<HTMLElement>('.ytp-settings-menu')!.hidden=false;vi.advanceTimersByTime(400);expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({menuOpen:true}),origin);stop();const calls=parent.postMessage.mock.calls.length;vi.advanceTimersByTime(800);expect(parent.postMessage).toHaveBeenCalledTimes(calls);});
it('accepts supported Bilibili rates only from this extension parent',()=>{const {video,send,parent}=setup();stop=mountEmbeddedPlayerInteraction('bilibili');send({qiaomuPlayer:'rate',rate:2},parent,'https://evil.example');expect(video.playbackRate).toBe(1.25);send({qiaomuPlayer:'rate',rate:2},{} as any);expect(video.playbackRate).toBe(1.25);send({qiaomuPlayer:'rate',rate:Infinity});expect(video.playbackRate).toBe(1.25);send({qiaomuPlayer:'rate',rate:2});expect(video.playbackRate).toBe(2);expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({rate:2}),origin);});
it.each(['youtube','bilibili'] as const)('sets actual 3x on the trusted %s video and rejects the unwanted 2.5x step',kind=>{const {video,send,parent}=setup();stop=mountEmbeddedPlayerInteraction(kind);send({qiaomuPlayer:'rate',rate:3});expect(video.playbackRate).toBe(3);expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({rate:3,availableRates:expect.arrayContaining([3])}),origin);send({qiaomuPlayer:'rate',rate:2.5});expect(video.playbackRate).toBe(3);});

it.each(['youtube','bilibili'] as const)('starts %s on handoff even when it was paused, retaining position and playback settings',kind=>{const {video,send,parent}=setup();const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();stop=mountEmbeddedPlayerInteraction(kind);const data={qiaomuPlayer:'handoff',time:28.5,rate:1.5,volume:.4,muted:true};send(data,parent,'https://evil.example');send({...data,time:Infinity});expect(play).not.toHaveBeenCalled();send(data);expect(video.currentTime).toBe(28.5);expect(video.playbackRate).toBe(1.5);expect(video.volume).toBe(.4);expect(video.muted).toBe(true);expect(play).toHaveBeenCalledOnce();});

it.each(['youtube','bilibili'] as const)('toggles %s playback only for the trusted parent',kind=>{const {video,send,parent}=setup();const play=vi.spyOn(video,'play').mockResolvedValue(),pause=vi.spyOn(video,'pause').mockImplementation(()=>{});stop=mountEmbeddedPlayerInteraction(kind);send({qiaomuPlayer:'toggle'},parent,'https://evil.example');expect(play).not.toHaveBeenCalled();send({qiaomuPlayer:'toggle'});expect(play).toHaveBeenCalledOnce();Object.defineProperty(video,'paused',{configurable:true,value:false});send({qiaomuPlayer:'toggle'});expect(pause).toHaveBeenCalledOnce();});
it.each(['youtube','bilibili'] as const)('seeks the trusted %s embed by ten seconds',kind=>{const {video,send,parent}=setup();stop=mountEmbeddedPlayerInteraction(kind);send({qiaomuPlayer:'skip',delta:10},parent,'https://evil.example');expect(video.currentTime).toBe(12);send({qiaomuPlayer:'skip',delta:100});expect(video.currentTime).toBe(12);send({qiaomuPlayer:'skip',delta:-10});expect(video.currentTime).toBe(2);send({qiaomuPlayer:'skip',delta:-10});expect(video.currentTime).toBe(0);send({qiaomuPlayer:'skip',delta:10});expect(video.currentTime).toBe(10);});

function bilibiliSurface(){
 const fixture=setup();
 document.body.innerHTML='<div class="bpx-player-video-area"><div class="bpx-player-video-perch"><div class="bpx-player-video-wrap"><video></video></div></div><div class="bpx-player-row-dm-wrap"><span>字幕</span></div><div class="bpx-player-control-wrap"><button>播放</button><div class="bpx-player-ctrl-quality" role="button">自动</div><input type="range"></div><div class="bpx-player-enter-button">进入哔哩哔哩，观看更高清</div><a href="https://www.bilibili.com/">作者</a></div>';
 const video=document.querySelector('video')!,redirect=vi.fn();
 document.querySelector('.bpx-player-video-area')!.addEventListener('click',redirect);
 return {...fixture,video,redirect};
}
it('toggles the Bilibili picture instead of following the embedded player redirect',()=>{
 const {video,redirect}=bilibiliSurface();const play=vi.spyOn(video,'play').mockResolvedValue(),pause=vi.spyOn(video,'pause').mockImplementation(()=>{});
 stop=mountEmbeddedPlayerInteraction('bilibili');
 const click=new MouseEvent('click',{bubbles:true,cancelable:true});video.dispatchEvent(click);
 expect(play).toHaveBeenCalledOnce();expect(click.defaultPrevented).toBe(true);expect(redirect).not.toHaveBeenCalled();
 Object.defineProperty(video,'paused',{configurable:true,value:false});document.querySelector<HTMLElement>('.bpx-player-row-dm-wrap span')!.click();
 expect(pause).toHaveBeenCalledOnce();expect(redirect).not.toHaveBeenCalled();
});
it('keeps Bilibili controls, source links and the explicit HD link clickable',()=>{
 const {video,redirect}=bilibiliSurface();const play=vi.spyOn(video,'play').mockResolvedValue();stop=mountEmbeddedPlayerInteraction('bilibili');
 for(const selector of ['button','.bpx-player-ctrl-quality','input','.bpx-player-enter-button','a']){
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector(selector)!.dispatchEvent(click);expect(click.defaultPrevented).toBe(false);
 }
 expect(redirect).toHaveBeenCalledTimes(5);expect(play).not.toHaveBeenCalled();
});
it.each(['youtube','foreign'] as const)('does not replace %s player picture clicks',kind=>{
 const {video,redirect}=bilibiliSurface();const play=vi.spyOn(video,'play').mockResolvedValue();
 if(kind==='foreign')vi.stubGlobal('location',{ancestorOrigins:['https://example.com']});
 stop=mountEmbeddedPlayerInteraction(kind==='youtube'?'youtube':'bilibili');video.click();expect(redirect).toHaveBeenCalledOnce();expect(play).not.toHaveBeenCalled();
});
it('removes Bilibili picture interception on cleanup',()=>{
 const {video,redirect}=bilibiliSurface();const play=vi.spyOn(video,'play').mockResolvedValue();stop=mountEmbeddedPlayerInteraction('bilibili');stop();video.click();expect(redirect).toHaveBeenCalledOnce();expect(play).not.toHaveBeenCalled();
});
it('requires a trusted parent before intercepting clicks where ancestorOrigins is unavailable',()=>{
 const {video,redirect,send}=bilibiliSurface();vi.stubGlobal('location',{});const play=vi.spyOn(video,'play').mockResolvedValue();stop=mountEmbeddedPlayerInteraction('bilibili');
 video.click();expect(redirect).toHaveBeenCalledOnce();expect(play).not.toHaveBeenCalled();
 send({qiaomuPlayer:'time'});video.click();expect(redirect).toHaveBeenCalledOnce();expect(play).toHaveBeenCalledOnce();
});
it('ignores modified clicks and avoids toggling twice on a double click',()=>{
 const {video,redirect}=bilibiliSurface();const play=vi.spyOn(video,'play').mockResolvedValue();stop=mountEmbeddedPlayerInteraction('bilibili');
 video.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));expect(redirect).toHaveBeenCalledOnce();expect(play).not.toHaveBeenCalled();
 video.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));video.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));expect(play).toHaveBeenCalledOnce();expect(redirect).toHaveBeenCalledOnce();
});
