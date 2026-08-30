/**
 * Shared by `Sheet` and `Confirm`'s `onCloseAutoFocus` (fix round F3 —
 * both carried the identical bug at analogous lines, so the fix lives once
 * rather than twice).
 *
 * Radix `FocusScope` restores focus to whatever was focused before the
 * dialog opened, unless the `onCloseAutoFocus` handler calls
 * `event.preventDefault()` — which is this codebase's signal that it is
 * taking over the restore itself, because the *opener* (the ref captured
 * when `Sheet`/`Confirm` first mounted) is who should get focus back, not
 * whatever Radix's own bookkeeping would pick.
 *
 * Two S7 flows close one of these while the opener no longer exists: `REMOVE
 * ON <trip>` settles the conflict and `OverClaimBand` returns `null`, and
 * `Start pack-out` moves the phase and the button that opened the confirm
 * unmounts (`isDraft` goes false). `focus()` on a detached node is a silent
 * no-op — it does not throw and does not move focus — so calling
 * `preventDefault()` regardless (guarded only by `instanceof HTMLElement`,
 * true for a detached node too) used to cancel Radix's own attempt for
 * nothing, leaving `document.activeElement` on `<body>`. `isConnected` is
 * what this checks before claiming the restore.
 */
export function restoreOpenerFocus(
  opener: Element | null,
  event: { preventDefault: () => void },
): void {
  if (opener instanceof HTMLElement && opener.isConnected) {
    event.preventDefault()
    opener.focus()
  }
}
