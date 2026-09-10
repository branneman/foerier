import { ErrorBoundary } from '@foerier/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

// Kept, and no longer load-bearing. The layer order used to depend on this
// line sitting above every component import — it did not, and the cascade
// shipped inverted for three months (`frontend-design.md` §4.1). The
// statement travels with `@foerier/ui`'s own barrel now, so this restates the
// intent rather than establishing it.
import '@foerier/ui/styles.css'

import { App } from './App'
import { BUILD_SHA } from './build'

/**
 * The service worker is registered here, from app code, rather than by
 * `vite-plugin-pwa`'s injected snippet.
 *
 * That is a CSP requirement, not a preference: the policy in
 * `auth-design.md` §8.2 carries no `unsafe-inline`, no hashes and no nonces,
 * so the build must emit zero inline script. The plugin's default registration
 * is exactly that.
 */
registerSW({ immediate: true })

const container = document.getElementById('root')
if (container === null) {
  throw new Error('index.html is missing #root')
}

/**
 * Three boundaries, and this is the outermost
 * ([frontend-design.md](../../docs/frontend-design.md) §5: *each screen and
 * each independent panel*). The other two are inside `AppShell`, around the
 * routed screen, and inside `TripPanels`, around each panel.
 *
 * This one catches what the other two cannot be under: `App` itself — the
 * session, the store wiring, the router. Its fallback is the whole page
 * because at this height there is no shell left to stand in, which is what
 * `variant="page"` says. It is also the only one a reader can be given with
 * no navigation available, so the copy's *reload the app* is the real move
 * here and the retry is the long shot.
 */
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary buildSha={BUILD_SHA} label="the app" variant="page">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
