import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import '@foerier/ui/styles.css'

import { App } from './App'

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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
