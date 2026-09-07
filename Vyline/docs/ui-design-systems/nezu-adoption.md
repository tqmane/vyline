# NezuUI adoption

Verified 2026-09-07 against `tqmane/NezuUI` commit
`69e156bbb91fdf6fb14f34cabcba8a8b3b4aa0b4` and `nezumi0627/vyline`
commit `cea7e4ee080b65ab298eb4378628adcd874b9b81`. The implementation source
of truth remains the local `tqmane/vyline` checkout, initially `7bef39a`.

## Sources and repository state

- [NezuUI README](https://github.com/tqmane/NezuUI/blob/69e156bbb91fdf6fb14f34cabcba8a8b3b4aa0b4/README.md)
- [Adoption guide](https://github.com/tqmane/NezuUI/blob/69e156bbb91fdf6fb14f34cabcba8a8b3b4aa0b4/docs/adoption.md)
- [Portable component skill](https://github.com/tqmane/NezuUI/blob/69e156bbb91fdf6fb14f34cabcba8a8b3b4aa0b4/skills/nezuui/SKILL.md)
- [Architecture decision](https://github.com/tqmane/NezuUI/blob/69e156bbb91fdf6fb14f34cabcba8a8b3b4aa0b4/docs/decisions/001-portable-components-and-pages.md)
- [Upstream composer adoption, PR 167](https://github.com/nezumi0627/vyline/pull/167)
- [Upstream legacy restoration, PR 168](https://github.com/nezumi0627/vyline/pull/168)

Reference clones are siblings of the working tree: `../NezuUI` and
`../vyline-upstream`. They are read-only references after cloning; no submodule
was replaced or initialized in either reference repository.

Upstream adopted NezuUI composer visuals in `dbc11fd`, changing only
`components/message-input.tsx` and `components/plus-menu.tsx`. Its current HEAD
reverts that change. The adoption remains available at
`archive/nezuui-2026-09-06`, which points to `dbc11fd`. The restore PR states
that the old UI should be the default; it does not identify a technical defect.
We use the adoption as a visual reference, not as a replacement for local code.

## Boundary and compatibility

NezuUI is React source designed for selective copying, not a Compose library
or a published component runtime (`package.json` is private). Its source uses
React hooks and native DOM controls; the current React 19 frontend already
provides the necessary runtime. No dependency or package-version upgrade is
required to use these primitives.

The host owns data fetching, persistence, routes, localization, LINE media URL
resolution, upload lifetimes, recording, and business rules. Portable components
accept presentation props, native event handlers, and children. They import no
Vyline store, API client, backend, or protocol code. Product adapters choose a
presentation and resolve host-specific values before passing them in.

`src/ui/nezu/` contains the adopted presentation primitives and their MIT
attribution. `--nezu-*` variables map to the host `--vy-*` semantic tokens,
allowing existing custom themes to continue controlling color. Component CSS
uses the `nezu-` prefix and includes reduced-motion treatment.

| Primitive | Source | Host responsibility |
| --- | --- | --- |
| FloatNotice | `FloatNotice.tsx`, `nezuui-components.css` | Notice content and lifetime; portable component provides status semantics. |
| Toggle | `Toggle.tsx`, `nezuui-components.css` | Controlled value and change callback; native button supplies keyboard activation. |
| Avatar | `Avatar.tsx`, `nezuui-components.css` | Resolve media URLs and names before rendering; presentation handles image failure. |
| Official/Premium badge | `Badges.tsx`, `nezuui-components.css` | Decide whether the account has the corresponding status. |
| ComposerSurface | `MessageComposer.tsx`, `message-composer.css` | Keep the real textarea, mentions, sticker panel, upload preview, reply, and recording controls as children. |

The surface retains NezuUI's 22 px geometry, focus lift, shadow, drag highlight,
and token-based colors. It contains no sending, recording, or attachment state.
Existing host controls stay mounted when the selected presentation changes.
The host scope `html[data-ui-mode="nezu"]` activates composer styles without
replacing its React subtree, preserving focus and native editor state while
switching designs. Sidebar, header, context menu, settings, and dialog adapters
use stable product classes and the same spacing and surface language.

The desktop settings arrangement also follows NezuUI's catalog: title/back
navigation above a narrow left rail, a separate broad content canvas, large
section headings, 7 px navigation corners, 10 px bordered panels, and a subtle
accent selection with a left inset line. On narrow screens, the existing
horizontal section navigation remains accessible without a fixed left rail.

## Why the catalog composer is not copied wholesale

The catalog's `MessageComposer` exposes controlled text, attachments, mute,
reply, and recording props, but also contains showcase fallback behavior:

- `flashSent` delays a callback by 420 ms and unconditionally displays success;
  `onSend` has no asynchronous error contract.
- Sticker and emoji selections are local sample glyph arrays, not LINE assets.
- The optional AI fallback is local text cleanup, and recording can use a timer
  without a MediaRecorder.
- Attachment payloads contain preview URLs, not the files needed by the host
  upload pipeline. There is no mention or sticon metadata contract.

Those behaviors are useful in a catalog but cannot replace Vyline's real
composer. The reusable surface and primitives are extracted; demo fallbacks
are omitted.

Local `message-input.tsx` also has newer behavior than upstream: streamed media
preparation, optimistic image groups, partial-send failure handling, object URL
ownership, account-switch guards, persistent mute defaults, a voice toggle,
and desktop/mobile Enter semantics. Upstream's combined send helper must not
overwrite this code. Any presentation change keeps these existing handlers.

## Upstream patterns retained

The adoption uses focus feedback, compact 64 px attachment previews, an upward
send arrow, a separate voice state, and a plus menu with descriptions, outside
click dismissal, Escape dismissal, and explicit menu semantics. These are
presentation patterns; schedule, ladder, poll, media, and message operations
stay in the host. FloatNotice, Toggle, Avatar, and badges already have closely
related antecedents in upstream's `float-notice.tsx`, `vy-ui.tsx`,
`official-badge.tsx`, and `premium-badge.tsx`.

## Verification scope

Run the desktop typecheck, targeted Biome checks, and the production build.
Browser verification must cover a narrow viewport, keyboard activation,
long notice content, image fallback, reduced motion, and a real host composer
with LINE-specific features. A successful catalog build alone does not prove
Vyline feature compatibility.

### Verified browser behavior (2026-09-07)

The following checks used a dedicated Chrome tab at
`http://127.0.0.1:5173/pr-demo`, with no LINE account or real message sending:

- Settings → Appearance/UI → NezuUI selected the renderer through the real UI.
  Reloading retained NezuUI. Light and dark appearances rendered correctly.
- A two-line draft and reply selection survived a NezuUI → Classic → NezuUI
  round trip through Settings. Reply opened from the real context menu.
- Space changed a controlled NezuUI switch; Enter restored it; Tab moved to
  the next switch. The native target measured 44 × 44 px and retained a visible
  keyboard focus indicator.
- At 1440 × 900, settings rendered with a 232 px left navigation rail, a separate
  content column, and the selected category's subtle accent surface/inset line.
- At 390 × 844, the settings navigation became horizontal. Document and body
  `scrollWidth` matched the viewport. Chat back navigation returned to the
  conversation list after final integration.
- The narrow composer displayed the toolbar above the editor. Its editor
  measured 306.7 px wide, and the surface corner radius measured 22 px. The
  keyboard outline follows the complete rounded surface instead of drawing a
  rectangle around the inner textarea.
- The runnable browser check emulated `prefers-reduced-motion: reduce` and
  verified that the focused composer had no transform. It also waits for the
  responsive layout to settle before checking editor width and back navigation.
- The final fresh NezuUI page produced no console warnings or errors during
  these checks. Keep icon fallback and official badge presentation remained
  visible through the adapters. LINE image URL conversion remains in the host
  adapter; the disconnected fixture does not validate authenticated images.

A shared PlusMenu defect was reproduced before correction: Escape and outside
clicks left the menu open. Its only caller is MessageInput. The fix adds open-only
pointer/Escape listeners, returns focus to its persistent trigger on Escape,
and exposes `aria-expanded` plus a named group of native action buttons. Tab
reaches the first action, and clicking the editor closes the menu while keeping
the draft. All five existing actions (event, ladder, poll, note, album) remain.

Repeat that regression check from `Vyline/apps/desktop`:

```powershell
bun run src/ui/nezu/nezu.browser-check.ts
```

`VYLINE_QA_URL` can target another local `/pr-demo` server, including a production
preview. The script rejects non-local destinations and never sends a message.
This browser check, desktop `typecheck`, targeted Biome checks for the eight
changed NezuUI/adapter/menu files, and `git diff --check` passed after the final
changes. The initial automated attempt ran while another UI stylesheet was
being created and failed during Vite import resolution; rerunning after that
file existed passed.

Local screenshots are in the ignored
`Vyline/apps/desktop/shots/ui-design-systems/` directory:
`nezu-settings-light-1440.png`, `nezu-settings-light-390.png`, and
`nezu-chat-light-390.png`. Screenshots were inspected, not just generated.

These are React NezuUI checks. Native Compose modes, actual login/upload/send,
and the combined production build are covered separately by the overall task.
The demo-only status pill overlapped the narrow header during capture; it is
outside the NezuUI renderer and remains a fixture limitation in these images.
