import { createElement, Lightbulb, ChevronRight, X } from 'lucide';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { t } from './ui-text';
const KEY='qiaomuStudyTipsDismissed';
export function mountStudyTips(container:HTMLElement){
 const doc=container.ownerDocument,root=doc.createElement('aside');root.className='q-study-tips';root.hidden=true;root.setAttribute('aria-label',t('小技巧'));
 const title=doc.createElement('strong');title.append(createElement(Lightbulb),doc.createTextNode(t('小技巧')));
 const text=doc.createElement('span');text.className='q-study-tip-text';text.setAttribute('aria-live','polite');
 const tips=[t('播放器聚焦时，K 或空格播放／暂停，J 回退 10 秒，L 前进 10 秒。'),t('在原网页，默认连按三次 A 进入阅读／学习模式，连按三次 I 快速记笔记。'),t('按住字幕上的拖动手柄调整位置，点击「完成」保存。'),t('在「字幕样式」中选择开源字体，即可自动加载并应用。'),t('已有字幕也能点击「换模型生成字幕」，选择另一个模型重新生成。')];
 let index=Math.floor(Math.random()*tips.length),disposed=false,dismissed=false;
 const next=doc.createElement('button');next.type='button';next.title=t('下一条');next.setAttribute('aria-label',next.title);next.append(createElement(ChevronRight));next.onclick=()=>{index=(index+1)%tips.length;text.textContent=tips[index];};
 const close=doc.createElement('button');close.type='button';close.title=t('关闭小技巧');close.setAttribute('aria-label',close.title);close.append(createElement(X));close.onclick=()=>{dismissed=true;root.hidden=true;void setLocalStorage(KEY,true).catch(()=>{});};
 text.textContent=tips[index];root.append(title,text,next,close);container.append(root);
 void getLocalStorage(KEY).then(value=>{if(!disposed&&!dismissed)root.hidden=value===true;}).catch(()=>{if(!disposed&&!dismissed)root.hidden=false;});
 if(!doc.getElementById('q-study-tips-style')){const style=doc.createElement('style');style.id='q-study-tips-style';style.textContent=`html .q-study-tips{display:flex;align-items:center;gap:8px;margin:10px 0 0;padding:9px 10px;background:var(--background-secondary,#f5f5f5);color:var(--text-muted,#666);border-radius:5px;font:400 12px/1.6 system-ui,sans-serif}html .q-study-tips[hidden],html .player-container:fullscreen .q-study-tips{display:none!important}html .q-study-tips strong{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-weight:500}html .q-study-tip-text{flex:1;min-width:0}html .q-study-tips svg{width:14px;height:14px;flex-shrink:0;mix-blend-mode:normal!important}html .q-study-tips button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:26px!important;height:26px;padding:0!important;margin:0;border:0;border-radius:4px;background:transparent;box-shadow:none;color:inherit;cursor:pointer}html .q-study-tips button:hover{background:var(--background-modifier-hover,#ddd)}html .q-study-tips button:focus-visible{outline:1px solid currentColor;outline-offset:2px}`;doc.head.append(style);}
 return ()=>{disposed=true;root.remove();};
}
