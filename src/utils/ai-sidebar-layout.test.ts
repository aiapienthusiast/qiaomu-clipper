// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';
it('uses a full-width native panel with solid background and usable controls',()=>{
 const css=compile(resolve('src/styles/ai-side-panel.scss'),{logger:{warn(){},debug(){}}}).css;
 // jsdom cannot resolve CSS custom properties in color declarations. Resolve only
 // the existing theme colors; selectors, layout, cascade and control rules stay real.
 const lightCss=css.split('var(--background-secondary)').join('#f6f6f6').split('var(--background-primary)').join('#ffffff').split('var(--text-normal)').join('#222222').split('var(--text-muted)').join('#666666');
 document.head.innerHTML='<style>'+lightCss+'</style>';
 document.body.className='ai-sidebar-chat';
 document.body.innerHTML='<header class="ai-page-header"><button>Quote</button></header><aside class="clip-chat"><div class="clip-chat-resize"></div><button class="clip-chat-model">Model</button></aside>';
 expect(getComputedStyle(document.querySelector('.clip-chat')!).width).toBe('100%');
 expect(getComputedStyle(document.querySelector('.clip-chat-resize')!).display).toBe('none');
 expect(getComputedStyle(document.querySelector('.ai-page-header button')!).width).toBe('auto');
 expect(getComputedStyle(document.querySelector('.ai-page-header button')!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
 expect(getComputedStyle(document.querySelector('.clip-chat-model')!).color).not.toBe('transparent');
});
