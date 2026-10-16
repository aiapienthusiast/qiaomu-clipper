// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: vi.fn() } } }));
import { getChannelsPlaybackMedia, channelsPlaybackPage, channelsStudyAddress, channelsShareAddress, isChannelsMedia, parseChannelsShare, readChannelsPlayback, channelsStudyBridge, probeChannelsStudy } from './channels-study';
const share='https://weixin.qq.com/sph/Fixture123';
const playback='https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture-token&eid=fixture-id';
const media='https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture';
const info={ok:true as const,title:'Fixture',author:'',seconds:110,thumbnail:null,site:'WeChat Channels',mediaUrl:media,video:true};
beforeEach(()=>document.body.replaceChildren());afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('accepts only canonical shares and Tencent media; never uses bearer playback URLs as history',()=>{
 expect(channelsShareAddress(share)).toBe(share);expect(channelsShareAddress('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123')).toBe(share);
 for(const u of [playback,share+'?token=x','http://weixin.qq.com/sph/Fixture123','https://user:pw@weixin.qq.com/sph/Fixture123','https://weixin.qq.com.evil.org/sph/Fixture123'])expect(channelsShareAddress(u)).toBeUndefined();
 expect(isChannelsMedia(share,media)).toBe(true);
 for(const u of [media.replace('https:','http:'),media.replace('finder.video.qq.com','evil.org'),media.replace('/251/20302/stodownload','/other'),media.replace('finder.video.qq.com','finder.video.qq.com:8080'),media+'#x'])expect(isChannelsMedia(share,u)).toBe(false);
});
it('uses the resolver own login, distinguishes 401, and rejects foreign playback origins',async()=>{
 vi.stubGlobal('location',{origin:'https://yuanbao.tencent.com'});const fetch=vi.fn().mockResolvedValueOnce({status:401}).mockResolvedValueOnce({ok:true,status:200,json:()=>Promise.resolve({code:0,data:{playable_url:'https://evil.org/?token=fixture'}})}).mockResolvedValue({ok:true,status:200,json:()=>Promise.resolve({code:0,data:{playable_url:playback}})});vi.stubGlobal('fetch',fetch);
 expect(await parseChannelsShare(share)).toEqual({state:'login'});expect(await parseChannelsShare(share)).toEqual({state:'unavailable'});expect(await parseChannelsShare(share)).toEqual({state:'ready',playbackUrl:playback});
 expect(fetch.mock.calls[0][0]).toBe('/api/weixin/get_parse_result');const req=fetch.mock.calls[0][1];expect(req.credentials).toBe('same-origin');expect(JSON.parse(req.body)).toEqual({type:'video_channel_url',url:share,scene:1});expect(req.headers).not.toHaveProperty('Cookie');
});
it('reads only the official feed and never forwards resolver cookies or returns the general token',async()=>{
 vi.stubGlobal('location',{href:playback});const fetch=vi.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({errCode:0,data:{errMsg:{type:0},feedInfo:{description:'Fixture',h264VideoInfo:{videoUrl:media}}}})});vi.stubGlobal('fetch',fetch);
 const answer=await readChannelsPlayback();expect(answer.state).toBe('ready');expect(JSON.stringify(answer)).not.toContain('fixture-token');expect(fetch.mock.calls[0][1].credentials).toBe('omit');
 vi.stubGlobal('location',{href:'https://evil.org/'});expect(await readChannelsPlayback()).toEqual({state:'unavailable'});expect(fetch).toHaveBeenCalledTimes(1);
});
it('requires explicit opening, reader ownership, exact share, and unchanged playback tab',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8});const get=vi.fn().mockImplementation(id=>Promise.resolve({url:id===7?'https://yuanbao.tencent.com/':playback}));const parse=vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info});const bridge=channelsStudyBridge({create,get,parse,inspect});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(parse).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'open',url:share})).toEqual({state:'opened'});
 expect(await bridge(2,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(await bridge(1,{mode:'read',url:share+'Other'})).toEqual({state:'unavailable'});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});expect(create).toHaveBeenLastCalledWith({url:playback,active:false});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'ready',info,sourceUrl:share});expect(JSON.stringify(await bridge(1,{mode:'read',url:share}))).not.toContain('fixture-token');
});
it('keeps login and rejected media failures recoverable, and rejects navigation races',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),get=vi.fn().mockResolvedValue({url:'https://yuanbao.tencent.com/'}),parse=vi.fn().mockResolvedValueOnce({state:'login'}).mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info:{...info,mediaUrl:'https://evil.org/video'}}),bridge=channelsStudyBridge({create,get,parse,inspect});
 await bridge(1,{mode:'open',url:share});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'login'});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});
 get.mockResolvedValue({url:playback});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});
 inspect.mockResolvedValue({state:'ready',info});get.mockResolvedValueOnce({url:playback}).mockResolvedValueOnce({url:playback+'&eid=other'});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});
});
it('starts no parsing until a disclosed user action and returns only stable source plus media',async()=>{
 const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValueOnce({state:'login'}).mockResolvedValueOnce({state:'loading'}).mockResolvedValueOnce({state:'ready',info,sourceUrl:share});const done=probeChannelsStudy(share,status,holder,request);
 const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};expect(request).not.toHaveBeenCalled();expect(holder.textContent).toContain('腾讯元宝解析');
 const [open,retry]=Array.from(holder.querySelectorAll('button'));expect(retry.disabled).toBe(true);open.click();await settle();retry.click();await settle();expect(holder.textContent).toContain('登录完成');retry.click();await settle();expect(holder.textContent).toContain('官方播放页');retry.click();expect(await done).toEqual({info,sourceUrl:share});
});

it('rejects navigation during playback inspection even when the media itself is valid', async () => {
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),get=vi.fn().mockResolvedValue({url:'https://yuanbao.tencent.com/'}),parse=vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info}),bridge=channelsStudyBridge({create,get,parse,inspect});
 await bridge(1,{mode:'open',url:share});await bridge(1,{mode:'read',url:share});get.mockResolvedValueOnce({url:playback}).mockResolvedValueOnce({url:playback+'&eid=other'});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(inspect).toHaveBeenCalledTimes(1);
});

it('automatically reads through login and playback loading after one disclosed open action',async()=>{
 vi.useFakeTimers();const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValueOnce({state:'login'}).mockResolvedValueOnce({state:'loading'}).mockResolvedValue({state:'ready',info,sourceUrl:share});const done=probeChannelsStudy(share,status,holder,request);
 holder.querySelector('button')!.click();await vi.advanceTimersByTimeAsync(10000);expect(await done).toEqual({info,sourceUrl:share});expect(request).toHaveBeenCalledTimes(4);await vi.advanceTimersByTimeAsync(20000);expect(request).toHaveBeenCalledTimes(4);
});
it('bounds automatic login checks and cancels further reads when the reader closes',async()=>{
 vi.useFakeTimers();const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValue({state:'login'});
 void probeChannelsStudy(share,status,holder,request);holder.querySelector('button')!.click();await vi.advanceTimersByTimeAsync(184000);const count=request.mock.calls.length;await vi.advanceTimersByTimeAsync(30000);expect(request).toHaveBeenCalledTimes(count);expect(holder.textContent).toContain('自动读取已暂停');window.dispatchEvent(new Event('pagehide'));expect(vi.getTimerCount()).toBe(0);
});
it('waits for freshly opened tabs instead of treating navigation as a failed video',async()=>{
 const create=vi.fn().mockResolvedValue({id:7}),get=vi.fn().mockResolvedValue({url:'about:blank',status:'loading'}),parse=vi.fn(),inspect=vi.fn(),bridge=channelsStudyBridge({create,get,parse,inspect});await bridge(1,{mode:'open',url:share});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});expect(parse).not.toHaveBeenCalled();
});
it('keys the official playback page by export id only and drops the token',()=>{
 const key='https://channels.weixin.qq.com/finder-preview/pages/feed?eid=fixture-id';
 expect(channelsPlaybackPage(playback)).toBe(key);expect(channelsPlaybackPage(key)).toBe(key);expect(channelsStudyAddress(playback)).toBe(key);expect(channelsStudyAddress(share)).toBe(share);
 expect(channelsPlaybackPage('https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a%2Fb')).toBe('https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a%2Fb');
 for(const u of ['https://channels.weixin.qq.com/finder-preview/pages/feed?token=only','https://channels.weixin.qq.com/finder-preview/pages/feed?eid=','http://channels.weixin.qq.com/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com.evil.org/finder-preview/pages/feed?eid=x','https://evil.org/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com/other?eid=x','https://u:p@channels.weixin.qq.com/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com/finder-preview/pages/feed?eid='+'a'.repeat(201)])expect(channelsPlaybackPage(u)).toBeUndefined();
 expect(isChannelsMedia(key,media)).toBe(true);expect(isChannelsMedia(playback,media)).toBe(true);expect(isChannelsMedia(playback,media.replace('finder.video.qq.com','evil.org'))).toBe(false);
});
it('lends the open playback tab media only for that exact video and a verified address',async()=>{
 const key='https://channels.weixin.qq.com/finder-preview/pages/feed?eid=fixture-id';
 const api=(answer:unknown,tabUrl=playback)=>({get:vi.fn().mockResolvedValue({url:tabUrl}),query:vi.fn().mockResolvedValue([{id:9,url:playback}]),sendMessage:vi.fn().mockResolvedValue(answer)});
 const good={url:key,info:{...info,title:'T',description:'D'}};
 expect(await getChannelsPlaybackMedia(key,5,api(good))).toMatchObject({ok:true,mediaUrl:media,title:'T',video:true});
 const other=api(good,'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=another');
 expect(await getChannelsPlaybackMedia(key,5,other)).toBeDefined();expect(other.query).toHaveBeenCalled();
 expect(await getChannelsPlaybackMedia(key,5,api({url:'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=other',info}))).toBeUndefined();
 expect(await getChannelsPlaybackMedia(key,5,api({url:key,info:{...info,mediaUrl:media.replace('finder.video.qq.com','evil.org')}}))).toBeUndefined();
 expect(await getChannelsPlaybackMedia(share,5,api(good))).toBeUndefined();
 const none=api(good);none.get.mockRejectedValue(new Error('closed'));none.query.mockResolvedValue([]);expect(await getChannelsPlaybackMedia(key,5,none)).toBeUndefined();
});
it('opens the Yuanbao check by itself only when the share page button asked for it',async()=>{
 vi.useFakeTimers();
 const make=(auto:boolean)=>{const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
  const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValue({state:'ready',info,sourceUrl:share});
  const done=probeChannelsStudy(share,status,holder,request,auto);return{request,done};};
 const manual=make(false);await Promise.resolve();expect(manual.request).not.toHaveBeenCalled();
 const auto=make(true);await Promise.resolve();expect(auto.request).toHaveBeenCalledTimes(1);expect(auto.request).toHaveBeenCalledWith({action:'qiaomuChannelsStudy',mode:'open',url:share});
 await vi.advanceTimersByTimeAsync(4000);expect(await auto.done).toEqual({info,sourceUrl:share});
});
it('opens the official playback page behind the study page and closes it once the video is read',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),remove=vi.fn().mockResolvedValue(undefined);
 const get=vi.fn().mockImplementation(id=>Promise.resolve({url:id===7?'https://yuanbao.tencent.com/':playback}));
 const bridge=channelsStudyBridge({create,remove,get,parse:vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect:vi.fn().mockResolvedValue({state:'ready',info})});
 await bridge(1,{mode:'open',url:share});await bridge(1,{mode:'read',url:share});
 expect(create).toHaveBeenLastCalledWith({url:playback,active:false});expect(remove).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'read',url:share})).toMatchObject({state:'ready'});expect(remove).toHaveBeenCalledWith(8);
});
