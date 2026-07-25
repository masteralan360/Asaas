import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEMO_SITE_URL,
  getDemoSetupUrl,
  getDemoSiteUrl,
  isDemoDeployment,
  isDemoEnabled,
} from './demoDeployment'

describe('demo deployment configuration', () => {
  it('recognises a dedicated demo build', () => {
    expect(isDemoDeployment({ VITE_APP_VARIANT: 'demo' })).toBe(true)
    expect(isDemoEnabled({ VITE_APP_VARIANT: 'DEMO' })).toBe(true)
  })

  it('keeps an explicitly enabled in-app demo available outside the dedicated build', () => {
    expect(isDemoDeployment({ VITE_APP_VARIANT: 'main' })).toBe(false)
    expect(isDemoEnabled({ VITE_ENABLE_DEMO: 'true' })).toBe(true)
    expect(isDemoEnabled({ VITE_ENABLE_DEMO: 'false' })).toBe(false)
  })

  it('uses the public demo URL and preserves the selected language', () => {
    expect(getDemoSiteUrl({})).toBe(DEFAULT_DEMO_SITE_URL)
    expect(getDemoSetupUrl('ar', {})).toBe(`${DEFAULT_DEMO_SITE_URL}/#/ar/demo-setup`)
  })

  it('accepts a valid deployment override and rejects malformed values', () => {
    expect(getDemoSiteUrl({ VITE_DEMO_SITE_URL: 'https://preview.example.com/path/' }))
      .toBe('https://preview.example.com')
    expect(getDemoSiteUrl({ VITE_DEMO_SITE_URL: 'javascript:alert(1)' }))
      .toBe(DEFAULT_DEMO_SITE_URL)
  })
})
