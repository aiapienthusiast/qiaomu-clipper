# Qiaomu Clipper: working rules

## Before any UI work (read this first, every time)
The same few mistakes have come back again and again. Check them *before* shipping, not after a screenshot.

1. **svg on the reader page.** `reader.scss` sets `mix-blend-mode: multiply` on every `svg` in light themes. A white icon on a dark button disappears. Any new control that draws an svg and can appear on `reader.html` needs `svg { mix-blend-mode: normal !important }` in its own scoped CSS. (Play button invisible, send icon invisible, ✨ missing: all this.)
2. **The app's global `button` / `select` / `input` styles.** `buttons.scss` makes every `button:not(.clickable-icon)` `width: 100%`, centred, with its own background, box-shadow and `:hover`. A lone `.my-button` loses to it. Scope under a parent (`html button.x:not(.y)` beats the global `:hover`), set `width: auto`, and define the `:hover` colours too. Use a `div[role=button]` for cards and rows.
3. **Translucent backgrounds on sticky things.** Anything `position: sticky/fixed` over scrolling text needs a *solid* background (stack the tint over `var(--background-primary)`). Never rely on a semi-transparent token alone.
4. **A button must look like a button.** A filled shape with a clear hover, not coloured text. Primary = ink fill (`--text-normal` on `--background-primary`), secondary = soft grey fill. Plain text links are for navigation only.
5. **Custom controls** (switch, select, slider, menu) are styled in full: `appearance: none`, a visible focus ring, hover, keyboard, `aria-*`. Do not ship a browser default next to a designed control.
6. **Icons**: lucide names must be registered in `src/icons/icons.ts` (import list *and* object). Elements built before they are in the document cannot use `createIcons()`; use `createElement(IconNode)` or inline svg.
7. **Switches** reset `mask: none` on `::after` (global `inputs.scss` draws a checkmark).
8. **`messages.json`** entries with `$name$` need a `placeholders` block.
9. **Verify with computed styles**, not by eye: in the jsdom/mock check `getComputedStyle` for colour, background, width on the real element. Say plainly what was *not* verified in a real browser.
10. **Field focus.** A focused input/textarea/select gets one soft ring: `border-color: var(--field-focus-border); box-shadow: var(--field-focus-ring); outline: none` (global in `inputs.scss`/`dropdowns.scss`). Never stack a second outline or a solid 2px ring; cards/rows/chips use at most `outline: 1px solid var(--text-muted); outline-offset: 2px`.

## Words the user sees
Write from the user's point of view. They care about what they get, not how it is done.
- Say **「生成字幕」**, not 「上传音频并生成」「开始识别」「转写任务」. A button names the result.
- Say where data goes **once, in the note under the choice** (「云端 · 音频会上传，按量计费」), never in the button.
- No protocol, endpoint, model-id, venv, ASR or "helper" jargon in primary flows. Technical fields belong inside a settings dialog.
- Prefer the user's own words: 字幕 / 文字稿 / 模型 / 本机 / 云端. 「换模型生成文字稿」, not 「换个方式重新生成」.
- One decision per dialog; everything undecided has a sensible default; a recommendation is stated, not left as a list of equals.

## Product defaults
- Recommend one local choice and the two cloud choices that were tested (豆包语音, 硅基流动 Qwen3-ASR); everything else lives behind 「添加其他」.
- Remember choices (per site where it makes sense). Ask again only when something must be installed or the user asks to change.
- Never silently send audio to a cloud service the user has not chosen.

## Releases and Git
- Commit and release only when the user says so. Pass `--repo` to `gh`; look for foreign commits before pushing.

## Build and test delivery

- Read `docs/BUILD-TESTING.md`. The user tests in ONE place: `~/Documents/乔木剪藏测试/extension`, in the Chrome profile named `乔木剪藏测试`. Do not give the user a worktree address to install.
- Default to `npm run build:store && npm run test:prepare`. Use `--edition local` only for standalone-edition testing; the destination stays the same. Never load it into the daily-use profile without an explicit request.
- Each worktree builds into its own `build/`; only explicit test preparation updates the fixed installation. Reload the actual installed extension and verify its displayed identity and helper connection before saying it is installed/tested.
- Before delivery, reconcile every requested feature with all relevant worktrees, including uncommitted changes. Update `test-delivery.json`; `test:prepare` runs its regression tests and rejects loss of an already installed feature. A merged site adapter does not establish that AI image input is included. Never bypass this gate by manually copying an old worktree build.
- `npm run package` is the only extension ZIP writer. Keep immutable candidates in `releases/`; never overwrite versioned archives or copy newer code into an older version-named directory.
- Extension version comes from package.json; helper version comes from native/VERSION. Build/install/publication are separate evidence boundaries. Preserve other threads' working files and legacy loaded directories until migration is verified.
