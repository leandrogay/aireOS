# Agent Guidelines for This Codebase

## Before writing any code

1. **Check for framework-specific docs first.** If this project uses Next.js, Next.js may ship
   version-specific docs at `node_modules/next/dist/docs/` (resolved relative to this file's
   directory — in monorepos it may not be visible from the repo root). Read anything relevant
   before assuming APIs match your training data; breaking changes and deprecations happen
   between versions.
2. **Look at existing code before writing new code.** Before creating a new page, component, or
   utility, find 1–2 similar ones already in the repo and match their:
   - File/folder structure and naming conventions
   - Component structure (function vs. arrow, props typing, file layout)
   - Styling approach (CSS modules, Tailwind, styled-components, etc. — use whatever's already
     there, don't introduce a second system)
   - State management patterns already in use (local state, context, a store library)
3. **Reuse before you build.** Check `components/`, `ui/`, `lib/`, or `hooks/` (or wherever this
   project keeps shared code) for something that already does what you need — a Button, a form
   field, a fetch wrapper, a formatting helper — before writing a new one. Prefer composing
   existing components over duplicating their logic.

## Coding priorities, in order

1. **Correctness** — it should work.
2. **Consistency** — it should look like it was written by the same person who wrote the rest of
   the codebase.
3. **Simplicity** — prefer the smallest, most boring solution that meets the requirement. Avoid:
   - New dependencies when an existing one already covers the need
   - New abstractions (HOCs, generic wrappers, config-driven components) for a single use case
   - Premature generalization — solve the problem in front of you, not every future variant of it
4. **Cleverness comes last, if at all.** If a simpler, more verbose version and a clever, terser
   version both work, prefer the simpler one unless the codebase's existing style clearly favors
   terseness.

## React-specific conventions

- Match the project's existing choice of function components vs. class components (should be
  function components + hooks in virtually all modern codebases — flag it if you see otherwise).
- Don't introduce a new state management library if the project already has one in use.
- Keep components small and colocate closely-related logic; split a component up only once it's
  actually doing too much, not preemptively.
- Match existing prop-typing conventions (TypeScript interfaces/types, PropTypes, or none).
- Reuse existing hooks (`useX`) before writing a new one that duplicates their behavior.

## Maintenance note

This file may be auto-generated or reset by tooling (e.g. `next dev` for Next.js projects,
via `node_modules/next/dist/server/lib/generate-agent-files.js`). If so, check whether your
edits to this file are being overwritten on each dev run, and if the project wants durable
customizations, add them in a separate file the tooling won't touch (or confirm the generator
supports persisting custom sections).