# Compose Web accessibility repair

The pinned Compose UI 1.12.0 Web listener tracks only one semantics owner. Closing a popup loses the underlying owner and leaves stale accessibility nodes. It also overwrites explicit roles with Button and captures the initial click callback. These failures were reproduced with the real Wasm menus, dialogs and live bridge updates.

This module rebuilds only `org.jetbrains.compose.ui:ui` for Wasm from its published source archive. `build.gradle.kts` checks the archive SHA-256 and every patched source fragment. Generated sources stay in `dist/gradle/patched-ui`; dependency caches are never modified. Other Compose libraries and the upstream license remain unchanged.

The repair retains the owner stack, restores the top interactive owner after dismissal, preserves explicit roles, exposes selected/checked/disabled/state-description values and resolves click actions from the current node. Kotlin 2.4 also requires the upstream `@PublishedApi` lock type to be published with its inline caller.

Verification: `node scripts/smoke.mjs --chat --motion --regressions`, `node scripts/smoke.mjs --chat --mobile`, and desktop `bun scripts/check-native-panels.ts`. The Web mirror deliberately debounces updates for up to one second; gesture checks wait for the resulting geometry before aiming another pointer action.

Remove this module and both dependency substitutions when an upstream Compose version passes these same popup, live-action and accessibility regressions. Do not carry these textual patches to a different source version without inspecting it.
