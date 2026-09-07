# Vyline Compose Web UI

The same-origin iframe renders a real Kotlin/Wasm application: conversation navigation, message history, native composer, replies, message actions, appearance settings, and Apple contact details. Apple uses Backdrop, Fluent uses Compose Fluent, and HyperOS uses Miuix. Layout changes between a single pane on narrow screens and a split view on larger screens.

The TypeScript host owns authentication, Zustand state, filtering, sorting, previews and every API operation. Native composer intents go through the existing `MessageInput` controller, preserving mentions, sticons, uploads, recording and send behavior. The controller remains mounted while its React presentation is hidden. Selecting Classic or NezuUI returns to their React renderer.

The full sticker/combination catalog, rich-content details, profile editing, advanced account/backup settings and call overlay use the host's existing compatibility surfaces. Native controls open those surfaces through the same host actions; their product logic is shared. Specialized message content can also mount the existing host `MessageBubble` renderer inline through a Kotlin-owned `HtmlElementView` slot, preserving its interaction and full information while the primary history and composer remain native.

## Build

Requires Java 17+; the Gradle 9.6.1 wrapper installs the remaining tools. From the Vyline repository root:

```powershell
bun Vyline/apps/compose-ui/scripts/build.mjs
# Faster local iteration:
bun Vyline/apps/compose-ui/scripts/build.mjs --development
```

Gradle outputs go to `dist/gradle/`. The script copies the distribution to `Vyline/apps/desktop/public/dist/ui-compose/`; the iframe URL is `/dist/ui-compose/index.html`. These use the repository's existing generated-file exclusion. Build Compose before the Vite production build. The host loads it only after a Compose mode is selected; Legacy/NezuUI do not download Kotlin, Skiko or the bundled fonts.

## Verified dependency choices

| Dependency | Version | Source checked |
| --- | --- | --- |
| Kotlin/compiler | 2.4.10 | Backdrop published Gradle metadata |
| Compose Multiplatform | 1.12.0 | Backdrop published Gradle metadata |
| `io.github.kyant0:backdrop` | 2.0.1 | [Source](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6) |
| `io.github.kyant0:shapes` | 1.2.1 | Existing Backdrop dependency; [continuous-curvature source](https://github.com/Kyant0/Shapes/tree/032af02e0ee88bd050d77997f25dd8adc2c49e1d) checked locally |
| `io.github.compose-fluent:fluent` | v0.1.0 | [Source](https://github.com/compose-fluent/compose-fluent-ui/tree/9e863ae958f349c9ddc9faa4299b090b87495ef4) and Maven Central stable publication |
| `top.yukonga.miuix.kmp:miuix-ui` | 0.9.3 | [Repository](https://github.com/compose-miuix-ui/miuix), latest stable Maven publication; 0.9.4-rc01 is prerelease |

All three library artifacts contain `wasmJs` variants and link together using Compose 1.12.0. Fluent's published artifact originally targets Kotlin 2.2.0 / Compose 1.8.2, and Miuix 0.9.3 targets Kotlin 2.4.0 / Compose 1.11.1. The consumer resolves them to the versions above. Their APIs remain experimental, so upgrades need browser validation as well as compilation.

## Rendering and accessibility

Apple uses an inset conversation pane on tablets and a large Messages heading with bottom search on phones, a centered avatar and glass name label, a separate attachment circle and thin glass composer, and a native contact pane that changes the remaining chat width. Shapes supplies continuous-curvature corners. SF Symbols are copied unchanged from the user-authorized local source assets; `SF_SYMBOLS.json` records source paths, view boxes and SHA-256 hashes. Fluent uses a native compact `NavigationView`, command buttons, list selection and text fields. Miuix uses native app bars, cards, bottom navigation, text fields and switches.

Apple records one Compose message-list layer and samples it for the name label, floating controls, composer and message menu. Effects run in documented order: vibrancy, blur, lens, then surface/highlight/shadow. Message bubbles and list rows have no backdrop effect. Avoid recording a surface that samples itself: Backdrop's exported layer is required for nested glass. [Backdrop effects](https://kyant.gitbook.io/backdrop/api/backdrop-effects), [nested surfaces](https://kyant.gitbook.io/backdrop/tutorials/glass-bottom-sheet).

Text, bubbles, lists and input controls render in Compose. Photos, static stickers and SVG images are decoded by the browser, reduced to a bounded bitmap, then painted by Skia. Kotlin-owned `HtmlElementView` elements retain browser audio/video controls and animated sticker support. These media elements overlay the canvas and are outside Backdrop's `GraphicsLayer` capture. The iframe isolates canvas ownership and disposes its complete runtime when leaving Compose modes.

`ClippedHtmlElementView` applies a DOM clip for the actual timeline viewport, excluding the header/composer, and prevents the uncut interop wrapper from intercepting input. Native overlays hide the underlying HTML views for their lifetime. The root uses `overflow: clip` so focusing an embedded HTML control cannot scroll the entire canvas.

ComposeViewport keeps its default accessibility DOM mirror enabled. Controls supply labels and selection state; message actions retain their pane semantics with a separate dismiss scrim. Compose 1.12 debounces accessibility updates by 100 ms, with a maximum 1000 ms under continuous invalidation, so browser tests wait for updated semantic text/bounds before clicking the canvas. Reduced motion disables overscroll and the 160 ms empty-field-to-send-button transition; application navigation and message positioning do not introduce animated transitions. Native library control animations remain library-owned.

Native Canvas text does not inherit browser fonts: bundled [Noto Sans JP](https://github.com/google/fonts/tree/main/ofl/notosansjp) registers CJK fallback weights 400/600/700. [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) supplies the color emoji fallback after browser verification found missing emoji glyphs with CJK alone. Both are licensed under SIL OFL 1.1 and load from the same origin without remote font requests or chat text disclosure. Their licenses are included beside the fonts; the emoji source revision and SHA-256 are recorded alongside its original file.

Kotlin/Wasm requires browsers with Wasm GC and exception handling support. The React host remains available when the module cannot load. [Browser requirements](https://kotlinlang.org/docs/wasm-configuration.html#browser-versions).

## Bridge

`Bridge.kt` mirrors `desktop/src/ui/compose-contract.ts`: `channel: "vyline-ui"`, `version: 1`, flat `snapshot` / `patch` / `ready` / `action` envelopes. Both frame source and exact origin are checked. A patch decodes only changed top-level fields, preserving unchanged message/list references while typing. Account epochs and chat IDs bind intents to the committed UI; the host rejects stale account or conversation actions. Files cross by structured cloning and enter the existing host upload controller.

`NativePanes` renders two to four `ChatScreen` instances in one runtime. The original host supplies pane geometry, focus, order and sizes. Small layouts retain all pane tabs and show the focused chat. `panePatches` and `messageDelta` update only the changed pane/message; each pane's callbacks capture an immutable `UiActionScope`. Paste follows the focused pane and drops use measured pane bounds.

`TextFieldValue` keeps selection and IME composition local while drafts persist in the host. Each recomposition reconciles the acknowledged host value with the local field; this also handles a draft echo and its send-time clearing arriving in one frame. A pending-echo guard prevents older host values from replacing newer typing. Kotlin contains no protocol, message-sending implementation, account session or call state machine.

Image loading accepts same-origin, blob and bounded image-data URLs, keeps up to 160 avatar thumbnails and 24 media previews, and releases full-size viewer bitmaps with the view. Lists use stable IDs and `LazyColumn`; only visible rows are composed. Conversation and composer widths are bounded on wide screens. Font and Wasm transfer size is paid when first entering a Compose mode, then browser caching applies.

## Browser checks

After a development distribution has been built:

```powershell
bun Vyline/apps/compose-ui/scripts/smoke.mjs --chat --extended
bun Vyline/apps/compose-ui/scripts/smoke.mjs --chat --profile
```

These use the workspace's existing Playwright dependency, a local host fixture and real canvas pointer/keyboard events. They exercise Japanese multiline input, send/clear/new-draft reconciliation, reply, appearance, SVG/sticker decoding, pending removal, mention selection, null-chat patches and 1200-item virtualization. Screenshots and optional DPR 2 resize/scroll measurements go to `dist/gradle/browser-smoke/`. Product integration is tested separately in the desktop app against the real shared host/controller; see [integration checks](../../docs/ui-design-systems/README.md).

## Licenses

Backdrop, Shapes, Compose Fluent and Miuix: Apache-2.0. Fluent system icon assets: Microsoft, MIT; `FluentCall.kt` and `FluentVideo.kt` are unchanged copies from the referenced Fluent repository's `fluent-icons-extended` module. Noto Sans JP and Noto Color Emoji: SIL OFL 1.1. SF Symbols: Apple; selected local source assets and SHA-256 hashes are listed in `SF_SYMBOLS.json`. No Apple font or user reference screenshot is included.
