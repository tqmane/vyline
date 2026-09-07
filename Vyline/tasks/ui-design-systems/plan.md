# UI design systems

## Contract

The current tqmane working tree is the product source of truth. Preserve authentication,
sync, calls, recording, optimistic uploads, rich messages and every existing chat action.
No backend/protocol/submodule replacement. UI/runtime work stays in `Vyline/`.
The requested Actions support also updates the root CI/release workflows and Docker build configuration.

## Decisions from inspection

- Keep the React product runtime and existing message/composer instances alive. Their
  local state owns pending File objects, recording streams and open interactions.
- Store presentation preference separately from account data and VyTheme palettes.
  Changing a design system must not reset either store or navigate/reload the page.
- Use portable presentation components with host-owned data and callbacks. NezuUI's
  catalog composer has simulated send/recording behavior and cannot replace the host
  composer verbatim. Inspect both upstream adoption and its subsequent revert.
- Apple, Fluent and Miuix MUST render the actual chat screen and composer in Kotlin /
  Compose Wasm. A native sidebar with a restyled React chat does not satisfy the contract.
  Use the real Backdrop, Compose Fluent and Miuix dependencies in those screens.
- Keep the existing TypeScript composer controller as the implementation of sending,
  metadata, pending Files and recording. Kotlin receives read-only presentation state
  and emits validated commands; it does not create a second product store/API stack.
- NezuUI and Classic remain React renderers. Compatibility overlays may retain React
  for specialized host features, and must be identified explicitly in the final report.
- Keep costly glass off message/list rows; measure viewport, virtualization and scroll
  behavior in the same browser before and after the change.

## Ordered work

1. Inventory current features and upstream/library evidence (parallel research).
2. Persisted design-system/appearance selection, theme resolution and stable runtime.
3. Native Compose Wasm dependency/build proof and host presentation contract.
4. Complete native Compose chat vertical slice: real host messages, draft, reply and send.
5. Apple Messages/Backdrop, Fluent and Miuix complete native chat presentations.
6. NezuUI portable components/token bridge with licensed source provenance.
7. Browser interaction/regression checks, performance measurements and production build.

Each slice must typecheck and retain usable legacy UI. Run focused tests after logic
changes; run the full defined typecheck/lint/frontend tests and production builds at
integration. Browser checks cover login, lists, chat, draft/send, attachment/reply/menu,
settings/mode persistence, 390/768/1024/1440 widths, light/dark/reduced motion and scroll.

## Baseline

- Start: clean `main` at 7bef39a; branch `codex/ui-design-systems` in main working tree.
- Root typecheck/lint pass; frontend tests: 118 pass, 0 fail.
- `vyl:doctor`: packages/submodules/dependencies present; `.env` missing. Authenticated
  network tests need a functioning local account; demo checks alone are not live proof.
- Existing `Vyline/tasks/plan.md` belongs to other work and is left intact.
- The user explicitly accepts demo verification and leaving real account sends unverified.
