# Frontend UI conventions

**What this doc is for:** how to write new frontend UI so it looks and behaves
consistently across features, now that shadcn/ui + Tailwind v4 are set up in
this project. Read this before adding any new page, card, button, chart, or
form control.

**What this doc is *not*:** a general Next.js/React guide, a backend guide, or
a step-by-step "how to install shadcn" — that's already done for the repo (see
`components.json`). This is specifically about the code-level habits that keep
new UI consistent with what's already here.

---

## 1. Use the primitives instead of hand-rolled Tailwind

Reusable UI primitives already exist in `app/components/ui/`: `Button`, `Card`
(+ `CardHeader`/`CardTitle`/`CardContent`/etc.), `Tabs`, `Chart`. Use these
instead of writing a new `<button className="...">` or `<div className="bg-white
border rounded-lg p-5">` by hand.

```jsx
// Don't
<button className="px-3 py-1 text-xs rounded-full border bg-blue-500 text-white border-blue-500">
  Highest first
</button>

// Do
import { Button } from "@/components/ui/button"
<Button variant="outline" size="sm">Highest first</Button>
```

Same visual result, but one shared definition instead of every feature
re-inventing its own button styling that slowly drifts apart.

## 2. Use theme tokens, not raw Tailwind color scales

Use the semantic tokens defined in `app/globals.css` — `bg-card`,
`text-card-foreground`, `border-border`, `bg-primary`, `text-muted-foreground`
— instead of `bg-white`, `text-gray-900`, `border-gray-200`.

**Why this matters, concretely:** those tokens have both a light and a `.dark`
definition already wired up in `globals.css`. Anything built with them gets
dark mode automatically. Anything built with raw `gray-*`/`white` classes
doesn't, and would need a manual `dark:` variant added to every element later.

If you need an AIRE brand color that isn't one of the generic tokens, use the
ones already defined in the `/* AIRE brand kit */` block in `globals.css`
(`--aire-violet`, `--aire-deep-blue`, `--aire-cream`, `--aire-lavender`,
`--aire-celest`) rather than hardcoding a hex value. If you need a genuinely
new brand color, add it there once, centrally — don't inline a new hex code
in a component.

## 3. Where components go

- **Feature-specific components** → `app/components/<feature>/` (e.g.
  `app/components/dashboard/`, `app/components/upload/`). If you're building a
  new feature, make a new folder here for it.
- **Generic, reusable primitives** → `app/components/ui/` only, and these
  should almost always be added via the CLI (next section), not hand-written.

There is exactly one `components` folder in this project, at `app/components/`.
Don't create a second one at the repo root — that's the exact duplication this
convention replaced.

## 4. Adding a new primitive

```bash
cd frontend/aireos
npx shadcn add <component>   # e.g. npx shadcn add select
```

Run it from `frontend/aireos` (where `components.json`/`jsconfig.json` live).
It will land in `app/components/ui/` automatically. If shadcn already offers a
primitive for what you're building, use the CLI instead of hand-writing your
own version of it.

## 5. `cn()` for conditional classNames

Import `cn` from `@/lib/utils` when a className needs to be conditional or
merged with a caller-supplied override, instead of building the string by hand
with ternaries/template literals:

```jsx
import { cn } from "@/lib/utils"
<div className={cn("px-2", isWide && "px-4", className)} />
```

`cn()` also resolves conflicting Tailwind utilities correctly (last one wins)
— every primitive in `ui/` already relies on this internally.

## 6. Icons

Use `lucide-react` (already a dependency, and the icon library declared in
`components.json`) for any new icon. Don't add a second icon library — mixing
icon sets is an easy way to make the UI look inconsistent even when everything
else follows this doc.

---

## What this doc does *not* ask you to do

It does **not** ask anyone to go back and rewrite existing hand-rolled UI
(e.g. the SKU ranking filters/table, the upload page) to use these primitives.
That's a real change to code someone else owns, and isn't something to push
through as a drive-by refactor. The expectation is: **new code follows this
doc**; existing UI gets migrated opportunistically, if and when whoever owns
that file is already touching it for other work — not as a dedicated
find-and-replace pass across the codebase.
