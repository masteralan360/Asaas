import { supabase } from '@/auth/supabase'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import type { PaygPricingCheckpoint } from '@/lib/paygPricing'

export interface PaygPricingProfile {
    id: string
    name: string
    checkpoints: PaygPricingCheckpoint[]
    isDefault: boolean
    createdAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProfile(value: unknown): PaygPricingProfile | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null

    const checkpoints = (Array.isArray(value.checkpoints) ? value.checkpoints : [])
        .flatMap((checkpoint): PaygPricingCheckpoint[] => {
            if (!isRecord(checkpoint)) return []
            const gb = Number(checkpoint.gb)
            const amountIqd = Number(checkpoint.amount_iqd)
            if (!Number.isFinite(gb) || !Number.isInteger(amountIqd)) return []
            return [{ gb, amountIqd, protected: gb === 1 || gb === 100 }]
        })
        .sort((left, right) => left.gb - right.gb)

    if (!checkpoints.length) return null
    return {
        id: value.id,
        name: value.name,
        checkpoints,
        isDefault: value.is_default === true,
        createdAt: typeof value.created_at === 'string' ? value.created_at : null,
    }
}

export async function getPaygPricingProfiles(): Promise<PaygPricingProfile[]> {
    const result = await runSupabaseAction(
        'paygProfiles.list',
        () => supabase.rpc('get_payg_pricing_profiles'),
        { timeoutMs: 12_000, platform: 'all' },
    ) as { data: unknown; error?: unknown }

    if (result.error) throw normalizeSupabaseActionError(result.error)

    const data = typeof result.data === 'string'
        ? (() => {
            try {
                return JSON.parse(result.data)
            } catch {
                return []
            }
        })()
        : result.data
    return (Array.isArray(data) ? data : [])
        .map(normalizeProfile)
        .filter((profile): profile is PaygPricingProfile => Boolean(profile))
}
