# Compliance Registry — Accessibility

Status: Skeleton (Phase 0) · Target: WCAG 2.2 AA

## Baseline conventions (enforced by design system)

- Focus: `:focus-visible` ring, never removed; logical tab order; no focus
  traps outside dialogs.
- Keyboard: every action operable by keyboard; dialogs close on ESC and
  return focus; roving tabindex in composite widgets.
- Semantics: real buttons/links/inputs; landmarks (`nav`, `main`); one `h1`
  per page; tables with `scope` headers and captions where used.
- Forms: explicit `<label htmlFor>`; errors identified in text + linked via
  `aria-describedby`; `aria-invalid` set; error summary on submit failures.
- Contrast: token pairs in `tailwind.config.ts` chosen for AA; verify any
  color change with a contrast check before merge.
- Motion: `prefers-reduced-motion` honored globally.
- Target size (2.5.8): interactive targets ≥ 24×24 px, comfortable 44 px.
- Responsive: usable from 320 px width; no horizontal scroll lock.
- Status messages announced via `role="status"`/`aria-live` (toasts).

## Automated + manual verification plan

| Check | Tool | When |
|---|---|---|
| ESLint jsx-a11y rules | lint | every PR |
| Keyboard-only walkthrough | manual script | every feature (DoD) |
| Screen reader pass (NVDA/VoiceOver) | manual | each new pattern |
| Contrast checks | tooling + manual | color changes |
| Zoom 320 px / 400% | manual | each layout feature |

Automated checks alone are explicitly NOT considered conformance; the DoD
requires the manual keyboard + SR pass on new features.
