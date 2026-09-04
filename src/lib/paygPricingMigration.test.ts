import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PAYG_PRICING_CHECKPOINTS, validatePaygPricingCheckpoints } from './paygPricing'

const profileSql = readFileSync(new URL('../../supabase/migrations/20260904230005_add_payg_profiles.sql', import.meta.url), 'utf8')
const terminationSql = readFileSync(new URL('../../supabase/migrations/20260904234004_add_immediate_payg_termination.sql', import.meta.url), 'utf8')

describe('PAYG profile migration', () => {
    it('seeds the immutable legacy and Standard PAYG profiles', () => {
        expect(profileSql).toContain('CREATE TABLE billing.payg_profiles')
        expect(profileSql).toContain("'Legacy PAYG Schedule'")
        expect(profileSql).toContain("'Standard PAYG'")
        for (const point of DEFAULT_PAYG_PRICING_CHECKPOINTS) {
            expect(profileSql).toContain(`{"gb":${point.gb},"amount_iqd":${point.amountIqd}}`)
        }
        expect(validatePaygPricingCheckpoints(DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeNull()
    })

    it('keeps closed cycles immutable while allowing an open cycle to be repriced', () => {
        expect(profileSql).toContain('pricing_profile_id')
        expect(profileSql).toContain('payg_profile_change_requires_open_cycle')
        expect(profileSql).toContain("v_change_timing = 'immediate'")
        expect(profileSql).toContain('closed_payg_cycle_snapshot_is_immutable')
    })

    it('freezes current usage when PAYG is terminated instead of discarding it', () => {
        expect(terminationSql).toContain('CREATE OR REPLACE FUNCTION public.admin_terminate_workspace_payg')
        expect(terminationSql).toContain('charged_usage_bytes = v_usage_bytes')
        expect(terminationSql).toContain("status = CASE WHEN v_amount = 0 THEN 'no_payment_required' ELSE 'awaiting_payment' END")
        expect(terminationSql).toContain("pending_billing_mode = 'monthly'")
        expect(terminationSql).toContain('payment_required')
    })
})
