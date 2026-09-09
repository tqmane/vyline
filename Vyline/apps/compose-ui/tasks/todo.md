# Acceptance checklist

- [x] Read user request, current motion validation and local library source; inspect attached video frames.
- [x] Baseline Kotlin compile and development distribution. Baseline motion browser test fails on reduced-motion route probe; diagnose before claiming a pass.
- [x] Apple labels remain stationary, pill slots aligned, continuous drag and release spring; test real pointer frames.
- [x] Touch scroll stays inside iframe, IME focus retained, readers/details/menu scroll, no dead overlay zones; test touch and focus.
- [x] Announcement preserves visual anchor; self-send/bottom incoming follow, older-history incoming stays, jump avoids composer; test actual layout.
- [x] Center call/system events and preserve call capabilities; test data projection and actions.
- [x] Compact Miuix/Fluent composer and native attachment menus; preserve all tools, validate both themes.
- [x] Fluent navigation maps icon/name/destination and collapses on mobile; inspect all tabs and widths.
- [x] Additional user report: Fluent hamburger center is slightly left of the other navigation icons; align slots/hit targets. Missing Fluent icons must come from `C:/Users/Tqmane/Documents/Git/themes/fluentui-system-icons`.
- [x] Additional user references: Apple long-press menu stays anchored to its bubble, plus menu matches the supplied iMessage video, waveform matches supplied screenshots, and header background is progressively blurred.
- [x] Apple icon sources must be copied from `C:/Users/Tqmane/Documents/Git/themes/SFSymbols`, preserving geometry and recording source paths.
- [x] Native presentation for specialist controllers: create group, settings, profile/member, tools, stickers and message details; preserve the existing callbacks and state. Native panels, nested prompts and sticker placement pass all three themes. Media interop remains limited to media and spatial media gestures.
- [x] Observe Network/bridge hydration and reuse existing caches; verify reload/theme reentry, expiry and account isolation.
- [x] Run requested development/production suites, desktop build; inspect screenshots and console, update evidence and unresolved gaps.

- [x] Additional user requirement: complete call screen review and browser coverage for fixed controls, docking/width, minimize/restore, recording, incoming calls over another panel, camera availability, group avatars, media scroll and retained streams. All three themes pass 54 production-Wasm scenarios; desktop keyboard width adjustment and reset also pass. Final compile, development and production browser suites, and desktop production build also pass; see MOTION-VALIDATION.md.

Fixture checks do not prove physical Android/iOS IME or real LINE two-party audio/video/recording. Keep those validation limits explicit in the final record.
