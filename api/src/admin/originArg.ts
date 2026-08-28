/**
 * Validates a Maintainer script's `--origin` override (`auth-design.md` §3.4,
 * §5).
 *
 * A device link's entire purpose is to sign in a Device that is not the one
 * running the script, and a join Invite is handed to someone else's browser
 * just the same. Deriving the printed origin from `NODE_ENV` alone only ever
 * produces `https://app.foerier.app` or `http://localhost:5173` — neither
 * reachable from a phone on the LAN — so `--origin` lets the Maintainer say
 * where the *receiving* device can actually reach the app.
 *
 * Rejected rather than tolerated: anything that is not `http:`/`https:`, and
 * anything with a path, query, or fragment. A path is the dangerous case —
 * `--origin http://host/join` would produce a doubled, broken link
 * (`http://host/join/join#secret`) — and the failure shows up as a passkey
 * ceremony refused on a device where nobody can see a stack trace, which is
 * the single hardest place to debug a typo.
 */
export function parseOriginArg(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`not a URL: ${raw}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`must be http: or https:, got: ${raw}`)
  }

  if (url.host === '') {
    throw new Error(`must include a host, got: ${raw}`)
  }

  if (url.pathname !== '' && url.pathname !== '/') {
    throw new Error(`must have no path, got: ${raw}`)
  }

  if (url.search !== '' || url.hash !== '') {
    throw new Error(`must have no query or fragment, got: ${raw}`)
  }

  // `.origin` rather than `raw`, so a trailing slash the caller typed doesn't
  // produce a subtly different link than the one without it.
  return url.origin
}

/**
 * The line every printed link gets, naming the origin it was built against
 * and the one fact a Maintainer handing it to someone else's device needs:
 * that device has to be able to reach it.
 *
 * For a non-`localhost`, non-HTTPS origin — the case `--origin` exists for —
 * adds the one honest limitation worth stating up front rather than letting
 * someone discover it as a bug: that origin is not a secure context, so no
 * service worker registers there (no offline mode, no PWA install) and
 * WebAuthn is unavailable. Neither matters for *this* link — redeeming a
 * join or device Invite this way runs no WebAuthn ceremony; it falls through
 * to the token-only path, which is the whole point of the compatibility
 * floor (`auth-design.md` §5).
 */
export function printOriginNote(origin: string): void {
  console.log(
    `  Printed for ${origin} — the device opening this link must be able to reach it.`,
  )

  const { protocol, hostname } = new URL(origin)
  const secureContext =
    protocol === 'https:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'

  if (!secureContext) {
    console.log(
      '  That origin is not a secure context: no offline mode, no PWA install, no',
    )
    console.log(
      '  WebAuthn there. This link needs none of that — it runs no ceremony.',
    )
  }

  console.log('')
}
