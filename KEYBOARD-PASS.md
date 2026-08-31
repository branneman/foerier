# The real-browser keyboard pass

A manual test procedure. **No tier in this repo can replace it**, which is why
it is written down rather than automated.

## Why this is manual

Tier 3 runs in jsdom, which computes no layout and does not model focus the way
a browser does. Two things it cannot observe:

- **Focus restoration to an opener that no longer exists.** `restoreOpenerFocus`
  guards on `isConnected`, so it only calls `preventDefault()` while the opener
  is still in the document. The branch where the opener has been unmounted — the
  common case, since confirming a removal destroys the row the button lived in —
  has never been proven in a real browser.
- **Focus trapping inside a Radix overlay.** Whether Tab escapes a `Sheet` to
  the page behind it is a browser behaviour.

The failure this hunts for is focus landing on `<body>`. A keyboard or
screen-reader user is then silently returned to the top of the document, having
lost their place in a list they may have scrolled a long way down.

## Setup

```sh
npm run dev     # http://localhost:5173
```

Open DevTools on the **Console** tab and paste this once. It turns focus, which
is invisible, into a running log:

```js
setInterval(() => console.log(document.activeElement.tagName,
  document.activeElement.textContent?.slice(0, 30)), 500)
```

**Put the mouse down.** A click sets focus and will mask exactly the bug being
hunted. Navigate with Tab / Shift-Tab / Enter / Space / Escape only.

## Fixture: reaching the over-claim band

Checks 2 and 3 need an over-claim on screen, which takes deliberate setup — the
band renders only when the fold actually reaches a contested state.

1. Create **two Trips**.
2. Move **both** past draft: `SET PHASE` → `Pack-out`. A draft claims nothing,
   so two drafts never conflict.
3. Add the **same Single-kind** piece of gear to both. The depot holds one; two
   claims over-claim it.

Open either Trip. The amber band sits above the gear list, carrying a
`REMOVE ON <other trip>` route.

## The checks

### 1. A local `✕` writes immediately — confirm it still does

On a Trip's own gear list, Tab to a row's `✕` and press Enter.

- **Expect:** the Entry is removed with **no dialog**. This is correct and
  deliberate — `Trip.tsx`'s tag-chip rule: one op, the gear untouched, re-adding
  is two taps.
- **Failure:** a confirm appearing here. That would be a regression, not a fix.

### 2. Confirm opened, then dismissed

In the band, Tab to `REMOVE ON <other trip>`, press Enter to open
`RemoveElsewhereConfirm`, then press **Escape**.

- **Expect:** focus returns to the `REMOVE ON` route it opened from.
- **Failure:** the console logs `BODY`.

### 3. Confirm opened, then accepted — the untested branch

Same route, but this time **confirm** the removal.

- **Expect:** the opener no longer exists, so focus must land somewhere
  deliberate — the band, the list, or the next route — never `BODY`.
- **Failure:** `BODY`, or focus on an element that was destroyed.

This is the one branch no test in the repo covers. It is the highest-value check
in this document.

### 4. A typed Bring-count commits on blur

Tab to a `Stepper` in the gear list, type `10` over the existing value, then
**Tab away** rather than pressing Enter.

- **Expect:** `10` is committed as **one** op — the sync indicator ticks once.
- **Failure:** several ops, or the typed value silently reverting.

Then repeat, pressing **Escape** instead of Tab.

- **Expect:** the committed value is restored.

### 5. Focus stays inside an open overlay

With any sheet or confirm open, hold **Tab** through roughly fifteen stops.

- **Expect:** focus cycles within the overlay and returns to its first control.
- **Failure:** focus reaching the page behind — a broken focus trap.

## A note on scope

Amendment ruling **I** removes the settle routes from the activation and reopen
sheets: a control that emits inside a cancellable confirm makes `Cancel` state
something false. After that round lands, the **standing band is the only surface
that settles**, so checks 2 and 3 above are the paths that survive, and the
nested confirm-inside-a-sheet case stops existing.
