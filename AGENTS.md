# AGENTS.md

Guidance for autonomous coding agents working in this repository.

## Project Snapshot

- Project type: static browser game (no bundler, no framework, no package manager files).
- Runtime: modern desktop/mobile browser.
- Entry point: `index.html`.
- Core logic: `game.js`.
- Styling: `styles.css`.
- Assets: images/audio/fonts in repository root and `fonts/`.

## Source of Truth

- Prefer existing in-repo patterns over generic best practices.
- Keep architecture simple: plain HTML/CSS/JS loaded directly by browser.
- Avoid introducing tooling unless explicitly requested.

## Commands (Build/Lint/Test)

This repo currently has **no configured build, lint, or automated test scripts**.

### Run locally

- it served by vs code lite server on http://localhost:3000

### Build

- No build step is required.
- Treat "build" as "files load without console/runtime errors in browser".

### Lint

- No linter config exists (`eslint`, `prettier`, `stylelint` not configured).
- Perform manual linting by following style rules in this file.

### Test

- No automated test framework is configured.
- Primary validation is manual gameplay testing in browser.

### Single test execution

- There is no single-test command because no test runner is set up.
- Use targeted manual checks instead (examples below):
  - "drag piece from slot 0 to valid cell"
  - "line clear awards points"
  - "game over appears when no moves remain"
  - "best score persists across reload"

## High-Value Manual Test Checklist

- App loads from `index.html` with no blocking errors.
- Splash screen "Play" starts game and hides overlay.
- Drag/drop works for touch and pointer devices.
- Preview highlighting appears only for valid placements.
- Score increments for placement and line clears.
- Combo text appears for multi-clear streaks.
- Particles/sound/haptics fail gracefully when unavailable.
- Game over modal appears and restart works.
- Best score saves/restores via `localStorage`.
- Layout remains usable on mobile viewport and orientation changes.

## Cursor and Copilot Rules

- `.cursorrules`: not present.
- `.cursor/rules/`: not present.
- `.github/copilot-instructions.md`: not present.
- Therefore, this `AGENTS.md` is the primary agent guidance file.

## Editing Scope and Safety

- Make minimal, localized changes.
- Do not rename/move core files unless task requires it.
- Do not add heavy dependencies for small fixes.
- Preserve existing gameplay behavior unless change request says otherwise.
- Keep static hosting compatibility (no server-side assumptions).

## JavaScript Style Guidelines

### Language level

- Use modern plain JavaScript compatible with evergreen browsers.
- Prefer `const`; use `let` only for reassignment.
- Avoid `var` in new code.

### Structure

- Keep functions small and purpose-specific.
- Group related constants near top of file.
- Keep DOM queries centralized where practical.
- Reuse existing helpers before adding new abstractions.

### Naming conventions

- Constants: `UPPER_SNAKE_CASE` (for true constants).
- Variables/functions: `camelCase`.
- Classes: `PascalCase`.
- Booleans: use readable prefixes (`is`, `has`, `can`, `should`).
- CSS class tokens in JS should map through dedicated lookup objects.

### Imports/modules

- Current code is non-module script (`<script src="game.js"></script>`).
- Do not introduce `import`/`export` unless explicitly migrating to modules.
- If modules are introduced, keep imports relative and deterministic.

### Types and data shapes

- No TypeScript in this repo.
- Use explicit runtime guards (`Number.isFinite`, null checks, bounds checks).
- Keep board data as simple arrays (`board[r][c]`).
- Clone mutable shape data when needed (`cloneShape`).

### DOM and performance

- Cache repeated DOM references when feasible.
- Prefer transform-based animation/movement over layout thrashing.
- Avoid unnecessary `innerHTML` churn in hot paths.
- Keep particle/effects counts conservative on mobile.

### Async and timing

- Use `async/await` for readable async flow.
- Wrap non-critical async features (audio/haptics/storage) with graceful fallback.
- Always clear timers/listeners during reset/cancel paths.

### Error handling

- Fail soft for optional features (audio, vibration, storage).
- Log concise warnings for diagnosable failures.
- Do not throw fatal errors for non-critical UX features.
- Use `try/catch` around browser APIs that can fail by permissions/policy.

### Events/input

- Use Pointer Events for unified mouse/touch behavior.
- Prevent default only where interaction requires it.
- Ensure drag state cleans up correctly on `pointercancel` and `blur`.

## CSS Style Guidelines

- Reuse `:root` CSS variables for theme colors/tokens.
- Prefer class-based styling; avoid inline styles except dynamic geometry.
- Keep animation durations/easings consistent with existing feel.
- Maintain responsive behavior for narrow/mobile screens.
- Preserve visual language of current game UI unless asked to redesign.

## HTML Guidelines

- Keep markup semantic and minimal.
- Preserve IDs/classes that JS relies on.
- Avoid embedding large scripts/styles in HTML when file-based pattern exists.
- Keep metadata (OG tags, favicon links) intact unless specifically updated.

## Asset Guidelines

- Use relative paths so app works from static hosting roots.
- Keep file sizes reasonable; optimize heavy images/audio when touching them.
- Do not reference remote assets unless task explicitly requires it.

## Acceptance Criteria for Changes

- Game still starts and can be played end-to-end.
- No new console errors in normal gameplay path.
- Existing save behavior (`BEST_SCORE_KEY`) remains compatible.
- Drag/drop + scoring + line clear + game-over flows remain functional.
- Changes are small, readable, and consistent with repository style.

## When Unsure

- Choose the smallest change that solves the request.
- Prefer readability and predictable behavior over clever abstractions.
- Leave clear code rather than adding speculative infrastructure.
