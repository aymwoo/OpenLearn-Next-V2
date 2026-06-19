---
phase: 11
slug: loader-bridge
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-20
---

# Phase 11 — UI Design Contract

> Visual and interaction contract for the dynamic MFE loader and host bridge phase.
> This phase builds container infrastructure components (MfeLoader, ErrorBoundary, loading/error fallbacks) — not form or input primitives.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | none (custom container components only) |
| Icon library | lucide-react (Loader2, AlertCircle, XCircle) |
| Font | Tailwind CSS 4 default (Inter/system-ui) |

**Design System Source:** Tailwind CSS 4 default theme, no custom overrides. All values derived from existing patterns in `src/App.tsx` and `src/index.css`.

---

## Spacing Scale

Declared values (must be multiples of 4), derived from Tailwind CSS 4 default spacing:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px (p-1) | Icon gaps, compact inline padding |
| sm | 8px (p-2) | Loading/error fallback inner padding, button gaps |
| md | 16px (p-4) | Default element padding (loading/error containers) |
| lg | 24px (p-6) | Section padding, card body padding |
| xl | 32px (p-8) | Layout gaps between sections |
| 2xl | 48px (p-12) | Major section breaks, empty-state vertical spacing |
| 3xl | 64px (p-16) | Page-level spacing (not used in this phase) |

**Exceptions:**
- `p-3` (12px) — error fallback button padding for visual balance (per existing pattern in App.tsx line 628: `px-4 py-1.5`)
- `gap-1.5` (6px) — loading spinner icon-text gap for tight alignment (per existing pattern in App.tsx line 608)

---

## Typography

Tailwind CSS 4 defaults, consistent with `src/App.tsx` patterns:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px (text-sm) | 400 (font-normal) | 1.25 (leading-5) |
| Label | 12px (text-xs) | 500 (font-medium) | 1.25 (leading-5) |
| Heading | 18px (text-lg) | 600 (font-semibold) | 1.55 (leading-7) |
| Display | 20px (text-xl) | 700 (font-bold) | 1.4 (leading-8) |

**Phase-specific usage:**
- Loading fallback heading: 14px (text-sm), 500 (font-medium), text-gray-500 — matches existing pattern in App.tsx line 597
- Error fallback heading: 16px (text-base), 600 (font-semibold), text-gray-800 — error title prominence
- Error fallback body: 14px (text-sm), 400 (font-normal), text-gray-500 — error description
- Error fallback buttons: 12px (text-xs), 600 (font-semibold), tracking-wide — matches existing App.tsx button pattern line 606-631

---

## Color

Tailwind CSS 4 default palette, consistent with existing `src/App.tsx` patterns:

| Role | Tailwind Value | Usage |
|------|---------------|-------|
| Dominant (60%) | white (#ffffff) / text-gray-900 (#111827) | Background surfaces, primary text |
| Secondary (30%) | gray-50 (#f9fafb) / border-gray-200 (#e5e7eb) | Loading/error fallback container, card surfaces |
| Accent (10%) | indigo-600 (#4f46e5) | Spinner icon, retry button background, error icon highlight |
| Destructive | red-500 (#ef4444) | Reserved — not used in this phase |

**Accent reserved for:** Spinner (Loader2 `text-indigo-600`), retry button (bg-indigo-600 text-white), retry button hover (bg-indigo-700), error icon (XCircle `text-indigo-600`), dismiss button border and text on hover (border-indigo-200 hover:text-indigo-700).

**Dismiss button colors:**
- Default: bg-white text-gray-600 border-gray-200
- Hover: text-gray-900 border-gray-300
- Matches existing App.tsx secondary button pattern (line 665)

**Error icon visual variant:** XCircle from lucide-react, rendered at `size={32}`, `text-indigo-600`, with `bg-indigo-50` background circle (matching existing pattern in App.tsx line 80).

---

## Copywriting Contract

All copy reuses or extends existing i18n keys in `src/i18n.ts`. No new i18n keys required for this phase — the existing `extensionLoadError` and `retry` keys cover the two UI states.

| Element | Copy (zh) | Copy (en) | Source |
|---------|-----------|-----------|--------|
| Loading spinner aria-label | "正在加载远程组件" | "Loading remote component" | D-15 |
| Error heading | `extensionLoadError`: "扩展组件加载失败" | `extensionLoadError`: "Extension failed to load" | Existing i18n key |
| Error body | "远程组件加载过程中出现错误。请检查网络连接后重试。" | "An error occurred while loading a remote component. Check your connection and try again." | D-16 |
| Retry button label | `retry`: "重新加载" | `retry`: "Retry Load" | Existing i18n key (D-16, D-17) |
| Dismiss button label | "忽略" | "Dismiss" | D-16 — new key not needed (hardcoded in component, or add to i18n as `dismiss`) |
| Dismiss button for screen readers | "关闭错误提示并显示占位区域" | "Dismiss error and show placeholder area" | D-16 (a11y) |

**Empty state:** Not applicable for this phase. MfeLoader has three states: loading, loaded, error. There is no "empty" state — if there is no remote to load, the parent should not render MfeLoader.

**Destructive actions:** None in this phase. The dismiss button hides the error message but does not destroy any state — it simply shows an empty placeholder area (D-16). No confirmation dialog needed.

---

## Interaction Contracts

### Loading State (D-15)

```
┌─────────────────────────────────┐
│                                 │
│          ◆ Spinner ◆            │  ← Loader2 animate-spin, text-indigo-600, size={24}
│                                 │
│     "正在加载远程组件..."       │  ← text-sm text-gray-500
│     "Loading remote..."         │
│                                 │
└─────────────────────────────────┘
```

**Container:** centered flex column, `p-12` vertical padding, full width, min-height of parent slot.

**Spinner animation:** `animate-spin` Tailwind utility class.

**Dismiss behavior:** No dismiss during loading. The user waits, or the timeout fires (D-18, default 30s), which transitions to error state.

### Error State (D-16)

```
┌─────────────────────────────────┐
│                                 │
│        ╳  Error Icon           │  ← XCircle size={32}, text-indigo-600
│                                 │
│   "扩展组件加载失败"           │  ← text-base font-semibold text-gray-800
│   "Extension failed to load"   │
│                                 │
│   "请检查网络连接后重试..."     │  ← text-sm text-gray-500, max-w-md centered
│   "Check your connection..."    │
│                                 │
│   ┌──────────┐ ┌──────────┐   │
│   │  重新加载 │ │   忽略   │   │  ← Retry: bg-indigo-600 text-white
│   │ Retry Load│ │  Dismiss │   │     Dismiss: bg-white text-gray-600 border
│   └──────────┘ └──────────┘   │
│                                 │
└─────────────────────────────────┘
```

**Container:** centered flex column, `p-8` vertical padding, full width, min-height of parent slot.

**Retry button (D-17):**
- Background: bg-indigo-600, hover: bg-indigo-700
- Text: text-white, text-xs font-semibold tracking-wide
- Padding: px-4 py-1.5 rounded-lg
- Shadow: shadow-sm, hover: shadow-md transition-all
- Click: triggers `handleRetry()` — resets ErrorBoundary state, re-attempts `loadRemote()`

**Dismiss button:**
- Background: bg-white, hover: bg-white
- Text: text-gray-600 hover:text-gray-900, text-xs font-semibold tracking-wide
- Border: border border-gray-200 hover:border-gray-300
- Padding: px-4 py-1.5 rounded-lg
- Shadow: shadow-sm, hover: shadow-md transition-all
- Click: triggers `handleDismiss()` — hides error UI, shows empty placeholder area

**Button spacing:** `gap-3` between retry and dismiss buttons.

**Timeout reached (D-18):** Same error UI as above, but error body text adds: "（加载超时）" / "(Loading timed out)". This differentiates network errors from timeout errors in the error description.

### Loaded State

No UI of its own — the container `div#mfe-root` is rendered by the remote's `mount()` function. MfeLoader acts as a transparent wrapper.

### Leak Detection Warning (D-20, Development Mode Only)

No visible UI. Outputs `console.warn` messages with the following format:

```
[MfeLoader:LeakDetector] Potential leaks detected after unmount:
  Active intervals: {N}
  Active listeners: {N}
  Active observers: {N}
```

Pattern matches existing `[MfeLoader]` and `[ErrorBoundary]` console prefix conventions in the codebase (see RESEARCH.md Common Operations).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required — shadcn not used |
| Third-party | none | not applicable — all dependencies are existing |

**No new package registrations.** This phase creates only user-land source files using already-installed packages: `react`, `react-dom`, `lucide-react`, `@module-federation/runtime`, `uuid`. No registry vetting gate needed.

---

## Component Inventory

| Component | File | States | Visual Elements | i18n Keys Used |
|-----------|------|--------|-----------------|----------------|
| MfeLoadingFallback | `src/components/MfeLoadingFallback.tsx` | rendering | Loader2 icon + text | (hardcoded or `loadingRemote`) |
| MfeErrorFallback | `src/components/MfeErrorFallback.tsx` | rendering | XCircle icon + heading + body + retry button + dismiss button | `extensionLoadError`, `retry` |
| MfeErrorBoundary | `src/mfe/MfeErrorBoundary.tsx` | normal, hasError | — (renders children or fallback) | none |
| MfeLoaderCore | `src/mfe/MfeLoaderCore.tsx` | loading, loaded, error | — (delegates to fallbacks) | none |
| MfeLoader (public) | `src/mfe/MfeLoader.tsx` | — | — (composition wrapper) | none |

---

## Accessibility

| Element | Requirement |
|---------|-------------|
| Loading spinner | `role="status"` + `aria-label="Loading remote component"` on container |
| Error icon | `aria-hidden="true"` (decorative) |
| Error heading | `role="alert"` for screen reader announcement on error mount |
| Retry button | `aria-label="Retry loading remote component"` |
| Dismiss button | `aria-label="Dismiss error and show placeholder"` |
| Error container | `role="alertdialog"` with `aria-labelledby` pointing to heading |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
