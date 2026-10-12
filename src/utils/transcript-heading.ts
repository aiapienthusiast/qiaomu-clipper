// Keep caption-specific choices and feedback alongside their heading, outside the global clip bar.
export function transcriptHeadingTools(transcript: Element): HTMLElement {
 const doc=transcript.ownerDocument;
 let row=transcript.querySelector<HTMLElement>(':scope > .transcript-heading-row');
 if (!row) {
  row=doc.createElement('div');row.className='transcript-heading-row';
  const heading=transcript.querySelector(':scope > h2') || doc.createElement('h2');
  if (!heading.textContent) heading.textContent='Transcript';
  transcript.prepend(row);row.append(heading);
 }
 let tools=row.querySelector<HTMLElement>('.transcript-heading-tools');
 if (!tools) { tools=doc.createElement('div');tools.className='transcript-heading-tools';tools.dataset.qiaomuUi='true';row.append(tools); }
 if (!doc.getElementById('transcript-heading-style')) {
  const style=doc.createElement('style');style.id='transcript-heading-style';
  style.textContent=`html .transcript-heading-tools .q-transcript-regenerate~.qiaomu-yt-gen[data-kind=offer]{display:none}html .transcript-heading-tools .q-transcript-regenerate~.qiaomu-yt-gen[data-kind=generated] .qiaomu-yt-gen-actions{display:none}html .transcript-heading-tools button.q-transcript-regenerate{display:inline-flex;align-items:center;justify-content:center;width:auto;min-height:30px;padding:5px 8px;white-space:nowrap;font:inherit;border:1px solid var(--background-modifier-border,#ccc);border-radius:4px;background:transparent;color:var(--text-muted,#666);box-shadow:none;cursor:pointer}html .transcript-heading-tools button.q-transcript-regenerate:hover{background:var(--background-modifier-hover,#ddd)}html .q-transcript-regenerate svg{width:16px;height:16px;mix-blend-mode:normal!important}html .q-transcript-regenerate:focus-visible{outline:1px solid var(--text-muted,#777);outline-offset:2px}html .transcript-heading-row{position:sticky;top:var(--transcript-heading-top,var(--youtube-bar-height,0px));z-index:25;background:var(--background-primary,#fff);padding:10px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:1.5em 0 .7em}html .transcript-heading-row::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:var(--transcript-heading-top,var(--youtube-bar-height,0px));background:var(--background-primary,#fff);pointer-events:none}html .transcript-heading-row>h2{margin:0;flex:1 0 auto}html .transcript-heading-tools{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text-muted,#666)}html .transcript-heading-tools .youtube-study-feedback{display:flex;align-items:center;gap:6px;margin:0;padding:0;font-size:12px;max-width:320px}html .transcript-heading-tools .youtube-study-feedback:has(.youtube-study-status:empty):not(:has(button:not([hidden]))):not(:has(.youtube-translate-toggle)){display:none}html .transcript-heading-tools .youtube-study-status{transition:opacity .2s}html .transcript-heading-tools .youtube-study-status[data-feedback-state=leaving]{opacity:0}@media(max-width:600px){html .transcript-heading-tools{gap:8px}html .transcript-heading-tools .youtube-study-feedback{max-width:240px}}@media(prefers-reduced-motion:reduce){html .transcript-heading-tools .youtube-study-status{transition:none}}`;
  doc.head.append(style);
 }
 return tools;
}
