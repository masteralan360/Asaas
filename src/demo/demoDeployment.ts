import { getPathWithLang } from '@/lib/i18nRouting'

type DemoEnvironment = Record<string, string | undefined>

export const DEFAULT_DEMO_SITE_URL = 'https://demo1-atlas.vercel.app'

function normalizeBoolean(value: string | undefined): boolean {
  if (!value) return false
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function normalizeDemoSiteUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_DEMO_SITE_URL

  try {
    const url = new URL(candidate)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin
    }
  } catch {
    // Fall through to the known public demo URL.
  }

  return DEFAULT_DEMO_SITE_URL
}

export function isDemoDeployment(environment: DemoEnvironment = import.meta.env): boolean {
  return environment.VITE_APP_VARIANT?.trim().toLowerCase() === 'demo'
}

export function isDemoEnabled(environment: DemoEnvironment = import.meta.env): boolean {
  return isDemoDeployment(environment) || normalizeBoolean(environment.VITE_ENABLE_DEMO)
}

export function getDemoSiteUrl(environment: DemoEnvironment = import.meta.env): string {
  return normalizeDemoSiteUrl(environment.VITE_DEMO_SITE_URL)
}

export function getDemoSetupUrl(
  language: string,
  environment: DemoEnvironment = import.meta.env,
): string {
  return `${getDemoSiteUrl(environment)}/#${getPathWithLang('/demo-setup', language)}`
}
