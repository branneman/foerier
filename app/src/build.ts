/**
 * The build's identity, in one place because two very different things read
 * it: the sign-in screen shows it, and `depot/store.ts` keys the local
 * snapshot on it (`docs/sync-protocol.md` §5.3).
 *
 * ## Why dev does not fall back to a constant
 *
 * §5.3's rule is that a snapshot written by a *different build* is discarded
 * and the log re-folded, because obligation 1 makes a reader retain ops it
 * could not fold. A constant `'dev'` would make every local build the same
 * build — so a snapshot folded by yesterday's reducer would be accepted by
 * today's, in the one environment where the reducer changes hourly. So a dev
 * build gets an identity unique to the **process**: every reload re-folds
 * from the log, which is exactly what §5.3 asks for and what §7's arithmetic
 * makes affordable.
 *
 * Production is unaffected: the Dockerfile sets `VITE_GIT_SHA`, and a
 * deployable is versioned by commit SHA (architecture §7).
 */
function devBuildId(): string {
  // `crypto.randomUUID` needs a secure context, which `http://localhost` is
  // but a dev server reached over a LAN address is not — hence the fallback.
  const random =
    globalThis.crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `dev-${random.slice(0, 8)}`
}

export const BUILD_SHA: string = import.meta.env['VITE_GIT_SHA'] ?? devBuildId()
