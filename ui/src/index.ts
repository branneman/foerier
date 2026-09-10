/**
 * **The stylesheet is imported first, and that is load-bearing.**
 *
 * `styles/index.css` opens with `@layer reset, tokens, base, layout,
 * components, utilities, overrides;` — the statement that gives the cascade
 * its order. CSS layers take their order from **first mention**, so whichever
 * stylesheet the bundler emits first decides it, and every `*.module.css` in
 * this package opens `@layer components { … }`.
 *
 * It shipped the other way round. `app/src/main.tsx` imported `ErrorBoundary`
 * from this barrel *above* its own `import '@foerier/ui/styles.css'`, so
 * module evaluation reached a dozen component modules first: `components` was
 * created before `reset` existed, and the declared order then appended every
 * other layer **after** it. The result was the cascade exactly inverted —
 * `reset`, `base`, `layout` and `utilities` all beating every component in
 * this package, and `frontend-design.md` §4.1's promise — *a utility can
 * never lose a specificity fight to a component* — false in the built bundle.
 *
 * **It was one import and one day.** `12c327d` added the crash fallback and
 * with it the first `ui` component `main.tsx` had ever imported; until then
 * the stylesheet genuinely was first and nothing was wrong. That is the whole
 * argument for putting the statement here: the trap is not a mistake anyone
 * made, it is that a perfectly ordinary import re-orders the cascade of the
 * entire app from a file that mentions no CSS. What it looked like: `reset`'s
 * `button { color: inherit }`
 * winning, so the journey rail's current chip painted its background and not
 * its text (white on white) and the sign-in CTA drew dark on dark; the FABs
 * losing `position: fixed` and standing in the content flow; Depot's title
 * row losing its layout.
 *
 * Importing it here makes the order a property of the package rather than of
 * one consumer's import order — any path that reaches a component reaches the
 * layer statement first. `app/src/main.tsx` keeps its own import, which is now
 * a no-op restating the same intent; `ui/src/index.test.ts` is the guard.
 */
import '../styles/index.css'

export { Logo, Mark } from './Logo'
export { IconDepot, IconFind, IconTrips } from './Icon'
export type { IconProps } from './Icon'
export type { LogoProps, MarkProps } from './Logo'

export { ErrorBoundary } from './ErrorBoundary'
export type { ErrorBoundaryProps } from './ErrorBoundary'

export { Band } from './Band'
export type { BandProps } from './Band'

export { Chip } from './Chip'
export type { ChipProps } from './Chip'

export { ExpiryChip } from './ExpiryChip'
export type { ExpiryChipProps } from './ExpiryChip'

export { Sheet } from './Sheet'
export type { SheetProps } from './Sheet'

export { Confirm } from './Confirm'
export type { ConfirmProps } from './Confirm'

export { GearRow } from './GearRow'
export type { GearRowProps } from './GearRow'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedOption, SegmentedControlProps } from './SegmentedControl'

export { StatusPill } from './StatusPill'
export type { StatusPillProps } from './StatusPill'

export { Stepper } from './Stepper'
export type { StepperProps } from './Stepper'

export { PersonCircle } from './PersonCircle'
export type { PersonCircleProps } from './PersonCircle'

export { PersonCluster } from './PersonCluster'
export type { PersonClusterEntry, PersonClusterProps } from './PersonCluster'

export { QrCode } from './QrCode'
export type { QrCodeProps } from './QrCode'
