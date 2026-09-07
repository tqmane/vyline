# Acceptance checkpoints

- [x] Source-backed feature/library/upstream inventory
- [x] Persisted mode selection changes presentation without losing host state
- [x] Native Compose Wasm development and production build
- [x] Usable Apple Messages / Liquid Glass mode
- [x] Usable Compose Fluent mode
- [x] Usable Miuix mode
- [x] NezuUI portable integration
- [x] Existing chat actions retained and browser-tested in the disconnected demo
- [x] Mobile/tablet/desktop, keyboard and reduced-motion checks
- [x] Scroll/performance comparison
- [x] Final typecheck, lint, tests and production build
- [x] Record remaining gaps and exact validation scope

2026-09-08: 138 frontend tests, root lint/typecheck and final production distribution pass.
Production Chrome interaction checks, idle DPR1/DPR2 performance and continuous-receive fixtures pass.
CI/Docker configuration is updated; execution there and real LINE sends/calls remain unverified.
See `Vyline/docs/ui-design-systems/verification.md`.
