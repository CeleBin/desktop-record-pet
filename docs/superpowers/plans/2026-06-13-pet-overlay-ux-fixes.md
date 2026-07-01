# Pet / Todo Overlay UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop pet and todo overlay feel immediately usable: single-clicking the pet opens the main panel, the todo overlay can be freely resized, title-less items display their content as the primary label, and overlay opacity settings visibly affect the overlay.

**Architecture:** Keep the changes small and local to the existing Tauri + React flow. Pet interaction stays in the pet webview frontend, overlay resizing is driven by the overlay window plus a persisted UI-size setting, title fallback is handled in shared frontend presentation/editing components, and opacity is applied from the existing settings store into the overlay shell so updates are visible without changing the data model.

**Tech Stack:** Tauri 2, React, TypeScript, Zustand, Rust, SQLite-backed settings persistence

---

## Risks and assumptions

- The pet click/drag conflict is assumed to be primarily implemented in `src/components/pet/PetShell.tsx`. If Task 1 shows the real blocker lives in a parent window handler, a Tauri drag API edge case, or another component, stop and redirect Task 2 to the true source instead of patching `PetShell.tsx` blindly.
- The overlay opacity setting is assumed to already load through the existing Zustand settings store. If Task 5 Step 1 shows the value is not present/reactive, first repair the settings flow before changing overlay visuals.
- Overlay size persistence is optional. Only add DB-backed persistence if Task 3 shows the size resets on reopen and the existing settings persistence path can support two new keys without disproportionate migration work.
- Title fallback is a presentation rule only. Do not copy content into the `title` field in storage unless the user explicitly asks for a data migration.

## File map

- Modify: `src/components/pet/PetShell.tsx`
  - Owns pet click/drag behavior; likely root file for fixing single-click open.
- Modify: `src/components/pet/PetMenu.tsx`
  - Keep right-click menu behavior aligned with the new primary click behavior.
- Modify: `src/components/todo/TodoItem.tsx`
  - Overlay list row title/content fallback logic.
- Modify: `src/components/todo/TodoDrawer.tsx`
  - Drawer editing/display logic for optional titles.
- Modify: `src/components/TodoOverlay.tsx`
  - Overlay shell styling, opacity application, and resize handling hookup.
- Modify: `src/store/settings.ts`
  - Reactively surface settings changes already persisted through Tauri commands.
- Modify: `src/store/todoOverlay.ts`
  - Only modify if Task 3 Step 1 shows overlay size must be tracked in frontend state across open/close.
- Modify: `src/lib/tauri.ts`
  - Only modify if Task 3 Step 1 shows the overlay needs missing window helpers or commands.
- Modify: `src/types/index.ts`
  - Only modify if Task 4 introduces a shared display helper type or Task 3 introduces explicit overlay-size types.
- Modify: `src-tauri/src/windows.rs`
  - Only modify if Task 3 Step 1 shows the current generic window helpers cannot support overlay resize/show persistence cleanly.
- Modify: `src-tauri/src/lib.rs`
  - Only modify if Task 3 Step 1 shows new Rust-side window commands are required.
- Modify: `src-tauri/src/db.rs`
  - Only modify if Task 3 Step 4 adds persisted `todo_overlay_width` / `todo_overlay_height` setting keys.
- Modify: `src-tauri/tauri.conf.json`
  - Ensure the overlay window is resizable and any relevant min size/default size is sensible.

## Task 1: Lock down current interaction and overlay constraints

**Files:**
- Inspect: `src/components/pet/PetShell.tsx`
- Inspect: `src/components/TodoOverlay.tsx`
- Inspect: `src/components/todo/TodoItem.tsx`
- Inspect: `src/components/todo/TodoDrawer.tsx`
- Inspect: `src-tauri/tauri.conf.json`
- Inspect: `src-tauri/src/windows.rs`

- [ ] **Step 1: Read the pet interaction path end-to-end**

Confirm whether `onMouseDown`/`onMouseUp` in `PetShell.tsx` already intends to call `showMainPanel()` and identify why a normal click is being swallowed.

- [ ] **Step 2: Read the todo overlay shell end-to-end**

Confirm which element owns overlay background, width, height, and pointer behavior inside `src/components/TodoOverlay.tsx`.

- [ ] **Step 3: Read title rendering/editing path end-to-end**

Compare how `TodoItem.tsx` and `TodoDrawer.tsx` behave when `record_title` is empty and `record_content` is present.

- [ ] **Step 4: Verify overlay window capabilities**

Check `src-tauri/tauri.conf.json` and `src-tauri/src/windows.rs` for current `todo-overlay` resizable/min-size/show behavior.

- [ ] **Step 5: Write down the root-cause notes inline in the working session**

Expected findings to verify:
- pet click may already call `showMainPanel()` but is blocked by drag timing / mouseleave sequencing / window drag behavior.
- overlay size may be visually fixed by CSS even if the window itself is resizable, or the window may be marked non-resizable in Tauri config.
- title-less items currently render `无标题` instead of falling back to content.
- opacity setting exists in `SettingsPanel.tsx` and store, but is not applied by the overlay shell.

Copy these findings into the working session notes. Each subsequent task depends on them; if a later task assumption contradicts a Task 1 finding, stop and re-evaluate before editing.

## Task 2: Fix single-click pet open without breaking drag

**Files:**
- Modify: `src/components/pet/PetShell.tsx`
- Inspect/possibly modify: `src/components/pet/PetMenu.tsx`
- Verify against: `src/lib/tauri.ts`

- [ ] **Step 1: Add or update a failing interaction reproduction note/test harness**

Check whether the project already has a frontend component test path for React UI interactions. If such a harness already exists, add a focused test for: left click opens main panel, drag still starts dragging, right click still opens context menu. If no such harness exists, skip adding new test infrastructure and document the manual reproduction sequence in working notes; keep the logic change minimal.

- [ ] **Step 2: Refactor the click-vs-drag threshold minimally**

Adjust `PetShell.tsx` so a normal left click deterministically calls `showMainPanel()` while a real drag still calls `startDragging()`. Prefer a single source of truth for pointer state rather than multiple loose flags.

- [ ] **Step 3: Preserve existing context menu behavior**

Make sure right-click still opens `PetMenu` and does not trigger `showMainPanel()`.

- [ ] **Step 4: Run targeted verification**

Verify manually in dev mode or via the lightest available harness:
- left click pet → main panel opens
- left drag pet → window drags instead of opening panel
- right click pet → menu opens

## Task 3: Make todo overlay window freely resizable

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/components/TodoOverlay.tsx`
- Modify: `src/store/todoOverlay.ts`
- Modify if required: `src/lib/tauri.ts`
- Modify if required: `src-tauri/src/windows.rs`
- Modify if required: `src-tauri/src/lib.rs`
- Modify if required: `src-tauri/src/db.rs`

- [ ] **Step 1: Confirm whether the blocker is Tauri window config, CSS layout, or both**

Do not change both blindly. Verify whether `todo-overlay` is currently non-resizable at the native window layer, visually clamped by CSS, or reset on show.

- [ ] **Step 2: Enable native resize in the minimal place**

If disabled in `tauri.conf.json`, mark `todo-overlay` as resizable and set sane defaults/minimums.

- [ ] **Step 3: Remove frontend layout constraints that fight resizing**

Update `TodoOverlay.tsx` so the root container fills the resized window instead of forcing a fixed width/height.

- [ ] **Step 4: Persist last overlay size if the current architecture already persists UI settings nearby**

Recommended keys if needed:
- `todo_overlay_width`
- `todo_overlay_height`

Only add them if size currently resets and the persistence path is straightforward through the existing settings DB.

- [ ] **Step 5: Verify manual resize behavior**

Expected behavior:
- user can resize width and height freely
- closing/reopening the overlay preserves size if persistence was added
- no clipped content or unusable scroll regions appear after resize

## Task 4: Make title optional and fall back to content in overlay UI

**Files:**
- Modify: `src/components/todo/TodoItem.tsx`
- Modify: `src/components/todo/TodoDrawer.tsx`
- Inspect: `src/types/index.ts`

- [ ] **Step 1: Define one shared display rule**

Use this exact rule in all overlay-facing UI:
1. If `record_title.trim()` is non-empty, show it as primary text.
2. Otherwise, use the first meaningful line/snippet from `record_content` as the primary text.
3. Only show `无标题` when both title and content are empty.

Rendering rule for fallback content: plain text only, no markdown rendering, trimmed, single-line in list contexts, and truncated to a sensible short preview (around 80 characters, ellipsized if needed).

- [ ] **Step 2: Apply the rule in `TodoItem.tsx`**

The list row should stop forcing `无标题` when useful content exists.

- [ ] **Step 3: Apply the rule in `TodoDrawer.tsx`**

The drawer header should display fallback content when title is empty, while still allowing the user to add/edit a title explicitly.

- [ ] **Step 4: Keep title editing optional**

Do not auto-copy content into the title column in storage. This is a presentation rule, not a data migration.

- [ ] **Step 5: Verify representative cases**

Check these scenarios manually:
- title present + content present
- title empty + content present
- title present + content empty
- title empty + content empty

## Task 5: Wire opacity setting into the live todo overlay visuals

**Files:**
- Modify: `src/components/TodoOverlay.tsx`
- Inspect/possibly modify: `src/store/settings.ts`
- Verify against: `src/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Trace the existing setting flow**

Confirm that `todo_overlay_opacity` is already loaded into Zustand settings and identify where the overlay component should subscribe to it.

- [ ] **Step 2: Apply opacity to the correct visual layer**

Bind the setting to the overlay background/shell layer that users actually perceive. Prefer changing the container background color/alpha (for example via `rgba(...)` or equivalent alpha-backed token) rather than applying opacity to the whole subtree containing text and controls.

- [ ] **Step 3: Normalize and guard the value**

Parse the setting string safely, clamp it to `[0, 1]`, and fall back to the current default if parsing fails.

- [ ] **Step 4: Verify live updates**

Changing the setting in the settings panel should visibly affect the overlay without requiring app restart if the overlay and settings store are already live in the same session.

## Task 6: Run verification and regression checks

**Files:**
- Verify all modified frontend files
- Verify any modified Rust/Tauri files

- [ ] **Step 1: Run frontend typecheck**

Run: `npx tsc --noEmit`
Workdir: project root (`C:\Users\14375\desktop-record-pet`)
Expected: exit code 0

- [ ] **Step 2: Run frontend production build**

Run: `npm run build`
Workdir: project root (`C:\Users\14375\desktop-record-pet`)
Expected: exit code 0

- [ ] **Step 3: Run Rust checks from Tauri app directory**

Run: `cargo check`
Workdir: `src-tauri`
Expected: exit code 0

- [ ] **Step 4: Run Rust tests if Rust files changed**

Run: `cargo test`
Workdir: `src-tauri`
Expected: exit code 0

- [ ] **Step 5: Run diagnostics on changed frontend files**

Use `lsp_diagnostics` on each changed TS/TSX file and resolve new errors before completion.

- [ ] **Step 6: Manual UX regression pass**

Verify all approved behaviors together:
- single-click pet opens main panel
- todo overlay still opens from menu/tray
- overlay can be resized freely
- title-less todo items show content instead of forcing title re-entry
- opacity setting visibly changes the overlay
