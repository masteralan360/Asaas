import type { PlanModuleKey } from '@/plans/workspacePlans'

export const DEMO_TIME_MIN = 5
export const DEMO_TIME_MAX = 15
export const DEMO_TIME_DEFAULT = 15
export const DEMO_CODE_PREFIX = 'demo.'

export type DemoJob = 'general' | 'market' | 'shop' | 'real_estate' | 'currency_exchange' | 'clinic'

export interface DemoJobConfig {
  id: DemoJob
  label: string
  allowedModules: PlanModuleKey[]
}

const ALWAYS_AVAILABLE: PlanModuleKey[] = [
  'ledger',
  'payments',
  'direct_transactions',
  'revenue_analytics',
  'sales_history',
  'members',
  'hr',
]

const MARKET_MODULES: PlanModuleKey[] = [
  'pos',
  'products',
  'discounts',
  'storages',
  'inventory_transfer',
  'inventory_transactions',
  'stock_adjustments',
  'loans',
  'installments',
  'accounting',
  'customers',
  'suppliers',
  'orders',
  'business_partners',
  ...ALWAYS_AVAILABLE,
]

const SHOP_MODULES: PlanModuleKey[] = [
  'pos',
  'products',
  'discounts',
  'storages',
  'inventory_transfer',
  'inventory_transactions',
  'stock_adjustments',
  'loans',
  'installments',
  'accounting',
  'customers',
  'suppliers',
  'orders',
  'business_partners',
  'ecommerce',
  ...ALWAYS_AVAILABLE,
]

const REAL_ESTATE_MODULES: PlanModuleKey[] = [
  'real_estate',
  'loans',
  'installments',
  'accounting',
  ...ALWAYS_AVAILABLE,
]

const CURRENCY_EXCHANGE_MODULES: PlanModuleKey[] = [
  'currency_exchange',
  'accounting',
  ...ALWAYS_AVAILABLE,
]

const CLINIC_MODULES: PlanModuleKey[] = [
  'clinical_appointments',
  'customers',
  'accounting',
  ...ALWAYS_AVAILABLE,
]

export const DEMO_JOBS: DemoJobConfig[] = [
  {
    id: 'general',
    label: 'General Demo',
    allowedModules: [], 
  },
  {
    id: 'market',
    label: 'Market',
    allowedModules: MARKET_MODULES,
  },
  {
    id: 'shop',
    label: 'Shop',
    allowedModules: SHOP_MODULES,
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    allowedModules: REAL_ESTATE_MODULES,
  },
  {
    id: 'currency_exchange',
    label: 'Currency Exchange',
    allowedModules: CURRENCY_EXCHANGE_MODULES,
  },
  {
    id: 'clinic',
    label: 'Clinic',
    allowedModules: CLINIC_MODULES,
  },
]

export const ENTERPRISE_MODULES: PlanModuleKey[] = [
  'pos',
  'instant_pos',
  'sales_history',
  'products',
  'storages',
  'inventory_transfer',
  'inventory_transactions',
  'stock_adjustments',
  'ledger',
  'payments',
  'direct_transactions',
  'members',
  'business_partners',
  'agents',
  'customers',
  'suppliers',
  'orders',
  'ecommerce',
  'travel_agency',
  'real_estate',
  'currency_exchange',
  'clinical_appointments',
  'loans',
  'installments',
  'discounts',
  'revenue_analytics',
  'team_performance',
  'invoice_history',
  'accounting',
  'hr',
  'expenses',
  'payroll',
  'whatsapp',
]

export function buildDemoCode(job: DemoJob, minutes: number): string {
  const suffix = Math.random().toString(36).substring(2, 8)
  return `demo.${job}.${minutes}.${suffix}`
}

export function parseDemoCode(code: string): { job: DemoJob; minutes: number } | null {
  if (!code.startsWith(DEMO_CODE_PREFIX)) return null
  const parts = code.split('.')
  if (parts.length < 3) return null
  const minutes = parseInt(parts[2], 10)
  if (isNaN(minutes) || minutes < DEMO_TIME_MIN || minutes > DEMO_TIME_MAX) return null
  return { job: parts[1] as DemoJob, minutes }
}

export function isDemoWorkspace(code: string | undefined | null): boolean {
  if (!code) return false
  return code.startsWith(DEMO_CODE_PREFIX)
}

export function getModulesToRevoke(job: DemoJob): PlanModuleKey[] {
  if (job === 'general') return []
  const config = DEMO_JOBS.find((j) => j.id === job)
  if (!config) return ENTERPRISE_MODULES.slice()
  const allowed = new Set(config.allowedModules)
  return ENTERPRISE_MODULES.filter((m) => !allowed.has(m))
}

export function getModulesToGrant(job: DemoJob): PlanModuleKey[] {
  if (job === 'general') return []
  const config = DEMO_JOBS.find((j) => j.id === job)
  if (!config) return []
  return config.allowedModules.filter((m) => !ENTERPRISE_MODULES.includes(m))
}

export const DEMO_JOB_DISABLED_FEATURES: Record<DemoJob, { href: string; feature: string }[]> = {
  general: [],
  market: [],
  shop: [{ href: '/ecommerce', feature: 'ecommerce' }],
  real_estate: [],
  currency_exchange: [],
  clinic: [],
}
