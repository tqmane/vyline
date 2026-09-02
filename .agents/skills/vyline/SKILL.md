---

name: vyline
description: >
Vyline repository-specific engineering workflow. Use for all changes to
tqmane/vyline, including LINE protocol, messaging, synchronization,
read receipts, E2EE, media, backup/restore, multi-account behavior,
backend APIs, frontend chat UI, Docker, and submodules.
---

---

# Vyline Engineering Skill

## Scope

Use this skill for all implementation, debugging, refactoring, review, or investigation work in the Vyline repository.

Vyline is a Bun + TypeScript + Hono + React application with its own LINE protocol implementation.

Primary priorities:

1. Data integrity
2. Existing behavior compatibility
3. LINE Desktop behavioral evidence
4. Correct synchronization
5. Security and privacy
6. Performance
7. Simplicity
8. Minimal code

Do not trade correctness or data integrity for fewer lines of code.

---

# Start Here

Before making a non-trivial change:

1. Read repository `AGENTS.md`.
2. Read the closest relevant documentation.
3. Inspect the actual implementation.
4. Identify affected workspace/submodule boundaries.
5. Run:

```bash
bun run vyl:doctor
```

Do not assume repository/submodule state is valid.

---

# Repository Boundaries

Important repositories/workspaces include:

```text
Vyline/apps/desktop
Vyline/backend
Vyline/packages/protocol
Vyline/packages/plugin
Vyline/packages/themes
tools
```

The following are Git submodules:

```text
tools
Vyline/packages/protocol
Vyline/packages/plugin
Vyline/packages/themes
```

Never assume editing the parent repository changes the contents or commit pointer of a submodule.

Before changing a submodule:

```bash
git submodule status
git -C <submodule> status
git -C <submodule> branch --show-current
git -C <submodule> log -1 --oneline
```

After changing it, verify both:

```bash
git -C <submodule> diff
git diff --submodule
```

---

# LINE Protocol Investigation

Do not invent LINE protocol behavior.

For protocol-related changes, start from:

```text
Vyline/packages/protocol/src/dictionary/rpcMap.ts
```

Trace in this order:

```text
linejsName
    ↓
desktopEvidence
    ↓
stackApi
    ↓
domainApi
    ↓
backendApi
```

Use LINE Desktop behavior or existing captured evidence as the source of truth whenever available.

Do not implement behavior only because an old LINE.js implementation behaved that way.

---

# Protocol Changes

Before changing protocol behavior:

1. Identify the RPC involved.
2. Find its entry in `rpcMap.ts`.
3. Inspect Desktop evidence.
4. Inspect the protocol implementation.
5. Inspect backend consumers.
6. Inspect frontend assumptions.
7. Determine compatibility with existing stored data.
8. Add or update regression coverage.

Avoid duplicating protocol conversion logic across layers.

Keep transport/protocol behavior inside protocol layers unless there is a clear reason otherwise.

---

# Message Synchronization

Message synchronization must be monotonic wherever possible.

Never destroy known historical information because a later sync returned less information.

Avoid replacing valid cached arrays or objects with empty/incomplete responses.

Deduplicate messages using stable LINE identifiers.

Synchronization must tolerate:

- repeated RPC responses
- reconnects
- duplicate events
- delayed events
- out-of-order events
- account switching
- incomplete history pages

A successful sync must not corrupt already-restored history.

---

# Read Receipts

Read timestamps are historical events.

Do not overwrite an already-known earlier per-message read timestamp merely because the user later read a newer message.

Example:

```text
Message A read at 10:00
Message B arrives
Message B read at 10:30
```

Message A must remain:

```text
10:00
```

and must not become:

```text
10:30
```

unless LINE itself supplies message-specific evidence indicating that value.

Treat conversation-level latest-read state separately from per-message historical read state.

Do not infer that one database field can safely represent both concepts.

---

# Multi-account Behavior

All state that can differ by LINE account must be scoped by account identity/MID.

This includes where applicable:

- session
- synchronization state
- settings
- caches
- unread state
- selected chat
- history
- restoration state
- media state
- background jobs

Account switching must not leave stale state from the previous account visible or active.

Never assume the first configured account is the active or canonical account.

When debugging a bug that appears only on the second account, first inspect state ownership and initialization.

---

# Backup and Restore

Backup/restore code is data-loss-sensitive.

Never:

- delete source data before successful verification
- mark restore complete before all required stages succeed
- silently skip unsupported records
- replace good local data with empty imported data
- assume individual-chat behavior also works for group chats

Restore operations should be:

```text
parse
→ validate
→ stage
→ apply
→ verify
→ commit state
```

Prefer idempotent restore operations.

Running restoration twice should not produce duplicated messages or corrupt state.

Group chats and USER chats must be tested separately.

---

# Database Changes

Before changing stored structures:

1. Find every reader.
2. Find every writer.
3. Find migration/import code.
4. Find backup/restore code.
5. Find serialization boundaries.

Preserve existing user data.

For schema changes, explicitly define:

```text
old representation
new representation
migration
rollback/fallback behavior
```

Avoid database-wide scans on interactive request paths when an index or incremental lookup can solve the problem.

---

# E2EE

E2EE changes are security- and data-integrity-sensitive.

Never:

- log plaintext secrets
- log private keys
- expose key material through diagnostics
- silently fall back from encrypted to plaintext behavior
- regenerate keys merely because lookup temporarily failed

Distinguish:

```text
key missing
key temporarily unavailable
invalid key
decryption failure
unsupported payload
```

Do not collapse these into one generic error if behavior differs.

Use existing key caches and known fast paths before introducing new RPC calls.

---

# Media

Media operations may be large and slow.

Avoid:

- loading whole large media into memory unnecessarily
- redundant downloads
- repeated encryption/decryption
- repeated key RPC calls
- UI-blocking processing

Preserve timeout/error semantics.

For retries, distinguish safe idempotent reads from potentially duplicate-producing writes.

---

# Backend

Backend uses Bun + Hono.

Keep HTTP boundaries explicit.

Validate untrusted input at the boundary.

Return intentional HTTP status codes.

Do not convert known domain errors into generic 500 responses.

Avoid exposing internal stack traces, tokens, filesystem paths, or key material.

For slow operations:

- measure first
- identify blocking I/O
- avoid unnecessary serialization
- avoid unbounded concurrency

---

# Frontend

Frontend uses React + Zustand.

Do not introduce new global state when component/local state is sufficient.

Avoid duplicating server state across unrelated stores.

Account-specific state must reset or switch atomically on account change.

For chat UI changes verify:

- initial load
- old history pagination
- new incoming message
- own outgoing message
- unread position
- read state
- account switch
- long conversation
- group conversation

---

# Virtualized Message Lists

Chat history must not require loading the entire conversation before becoming usable.

Avoid permanent background loading of all history.

Preferred behavior:

```text
load enough for viewport
→ prefetch a reasonable nearby window
→ fetch older history as needed
→ maintain stable scroll anchor
```

When older messages are inserted above the viewport, preserve the user's visible position.

Variable-height rows must correctly invalidate/recompute measurements.

Do not fix scrolling bugs by disabling virtualization for large conversations.

---

# Performance

Measure before optimizing.

For history/database performance inspect:

```text
number of DB queries
rows scanned
payload size
serialization cost
duplicate RPC calls
duplicate rendering
React rerenders
virtual list measurements
network round trips
```

Prefer eliminating repeated work over adding complex caching.

A cache must define:

```text
key
scope
lifetime
invalidation rule
failure behavior
```

No unbounded caches.

---

# Timeouts

Timeouts are failure boundaries, not performance fixes.

If an operation hits 504/524:

1. locate where time is spent
2. determine whether it is CPU, DB, network, serialization, or upstream RPC
3. reduce unnecessary work
4. move genuinely long work off request-critical paths when appropriate
5. only then reconsider timeout values

Do not fix a 524 solely by increasing the timeout.

---

# Security

Treat these as sensitive:

```text
LINE tokens
session credentials
E2EE key material
backup archives
device identifiers
diagnostic logs
imported files
```

Never commit credentials.

Sanitize diagnostic exports.

Validate archive paths to prevent traversal.

Validate imported data before applying it.

Do not loosen LAN exposure/CORS/authentication as a debugging shortcut.

---

# Docker

Docker changes must remain compatible with constrained hosts where practical, including Raspberry Pi class devices.

Do not assume:

- unlimited RAM
- x86_64 only
- fast storage
- high CPU availability

Avoid unnecessary build dependencies and oversized images.

When architecture matters, verify release architecture explicitly.

---

# Git and Submodules

Prefer small atomic changes.

Do not mix unrelated refactors into bug fixes.

Before completion inspect:

```bash
git status --short
git diff --stat
git diff
git submodule status
```

If a submodule changed, inspect its diff independently.

Do not claim a submodule update succeeded only because `.gitmodules` points to the correct repository.

The parent repository records a specific submodule commit.

---

# Debugging Workflow

For bugs:

```text
REPRODUCE
↓
TRACE
↓
LOCALIZE
↓
EXPLAIN ROOT CAUSE
↓
MINIMAL FIX
↓
REGRESSION GUARD
↓
VERIFY
```

Do not start by rewriting the subsystem.

Separate symptom fixes from root-cause fixes.

When several bugs appear together, determine whether they share a state/lifecycle boundary before fixing them independently.

---

# Refactoring

Refactoring must preserve behavior unless behavior changes are explicitly part of the task.

Before large refactors:

1. identify external behavior
2. establish regression tests
3. remove dead/duplicate code
4. simplify state flow
5. split only where a real responsibility boundary exists

Do not add repositories/services/managers/factories merely to make architecture appear cleaner.

Prefer deleting unnecessary abstractions.

---

# Testing

At minimum after TypeScript changes run the smallest relevant validation first.

Examples:

```bash
bun run typecheck
```

and targeted tests where available.

For frontend-visible changes, runtime/browser verification is required when practical.

For protocol/data bugs, add a regression case that reproduces the original failure.

Test both positive and failure paths for data-sensitive operations.

---

# Final Verification

Before saying a task is complete:

```text
[ ] Root cause identified
[ ] Minimal required change implemented
[ ] Existing behavior considered
[ ] Data migration/compatibility considered
[ ] Account scoping checked
[ ] Submodules checked
[ ] Typecheck passed
[ ] Relevant tests passed
[ ] Runtime behavior checked where applicable
[ ] Diff reviewed
[ ] No secrets/debug artifacts added
```

Never report success only because code compiles.

---

# Skill Composition

Use other skills selectively.

Normal bug fix:

```text
ponytail
debugging-and-error-recovery
test-driven-development
code-review-and-quality
```

Frontend/UI:

```text
ponytail
frontend-ui-engineering
browser-testing-with-devtools
performance-optimization
```

Protocol/backend:

```text
ponytail
api-and-interface-design
source-driven-development
debugging-and-error-recovery
security-and-hardening
test-driven-development
```

Database/restore:

```text
ponytail
debugging-and-error-recovery
test-driven-development
security-and-hardening
performance-optimization
```

Large refactor:

```text
ponytail
context-engineering
code-simplification
incremental-implementation
test-driven-development
code-review-and-quality
```

Release/CI:

```text
git-workflow-and-versioning
ci-cd-and-automation
shipping-and-launch
security-and-hardening
```

Load only the skills needed for the current task.

Do not load every available skill into context simultaneously.
