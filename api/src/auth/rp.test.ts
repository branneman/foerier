import { afterEach, describe, expect, it, vi } from 'vitest'

import { PRODUCTION_ORIGIN, rpConfig } from './rp.ts'

describe('rpConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('development has just its two constants when FOERIER_DEV_ORIGINS is unset', () => {
    expect(rpConfig('development').allowedOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ])
  })

  it('development appends FOERIER_DEV_ORIGINS, comma-separated, trimmed, empties dropped', () => {
    vi.stubEnv(
      'FOERIER_DEV_ORIGINS',
      ' http://192.168.1.42:5173 ,,http://192.168.1.42:4173,',
    )

    expect(rpConfig('development').allowedOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
      'http://192.168.1.42:5173',
      'http://192.168.1.42:4173',
    ])
  })

  // The assertion that matters: this is the guard against FOERIER_DEV_ORIGINS
  // becoming a way to widen production's allowlist from the environment.
  // Production's allowlist must stay a constant no environment variable can
  // reach, even one that would otherwise parse as a perfectly good origin.
  it('production ignores FOERIER_DEV_ORIGINS even when set', () => {
    vi.stubEnv('FOERIER_DEV_ORIGINS', 'https://evil.example')

    expect(rpConfig('production').allowedOrigins).toEqual([PRODUCTION_ORIGIN])
  })

  it('test ignores FOERIER_DEV_ORIGINS even when set', () => {
    vi.stubEnv('FOERIER_DEV_ORIGINS', 'https://evil.example')

    expect(rpConfig('test').allowedOrigins).toEqual([PRODUCTION_ORIGIN])
  })
})
