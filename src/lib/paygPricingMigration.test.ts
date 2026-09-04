import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PAYG_PRICING_CHECKPOINTS, validatePaygPricingCheckpoints } from './paygPricing'

const initialSql = readFileSync(new URL('../../supabase/migrations/20260901110000_add_payg_workspace_billing.sql', import.meta.url), 'utf8')
const updateSql = readFileSync(new URL('../../supabase/migrations/20260904153352_update_fresh_payg_anchor_in_place.sql', import.meta.url), 'utf8')
const validator = (sql: string) => sql.match(/CREATE OR REPLACE FUNCTION billing\.validate_payg_checkpoints[\s\S]*?\$function\$;/)?.[0]

describe('fresh PAYG pricing correction', () => {
    it('keeps clean installs and the in-place update on the same validator', () => {
        expect(validator(initialSql)).toBeDefined()
        expect(validator(updateSql)).toBe(validator(initialSql))
        const seed = initialSql.match(/SELECT billing\.validate_payg_checkpoints\(\s*'([^']+)'::jsonb/)?.[1]
        const seedPoints = JSON.parse(seed!).map((point: { gb: number; amount_iqd: number }) => ({
            gb: point.gb, amountIqd: point.amount_iqd, protected: true
        }))
        expect(seedPoints).toEqual(DEFAULT_PAYG_PRICING_CHECKPOINTS)
        expect(validatePaygPricingCheckpoints(seedPoints)).toBeNull()
    })

    it('updates the initial row without creating a pricing version or deleting data', () => {
        expect(updateSql).toMatch(/UPDATE billing\.payg_pricing_versions\s+SET checkpoints/)
        expect(updateSql).not.toMatch(/\b(?:INSERT INTO|DELETE FROM|TRUNCATE)\s+billing\./i)
        expect(updateSql).not.toMatch(/\bSET\s+(?:version_number|id|retired_at|published_at)\s*=/i)
        expect(updateSql).not.toContain('admin_publish_payg_pricing_schedule')
    })

    it('guards existing PAYG activity and custom prices before changing anything', () => {
        const guardEnd = updateSql.indexOf('$guard$;', updateSql.indexOf('DO $guard$'))
        expect(guardEnd).toBeLessThan(updateSql.indexOf('CREATE OR REPLACE FUNCTION'))
        expect(updateSql).toContain("payg_enabled OR pending_billing_mode = 'payg'")
        expect(updateSql).toContain('EXISTS (SELECT 1 FROM billing.payg_cycles)')
        expect(updateSql).toContain("payment_type = 'payg'")
        expect(updateSql).toContain('fresh_payg_anchor_change_would_overwrite_custom_checkpoints')
        expect(updateSql).toContain('fresh_payg_anchor_change_requires_initial_schedule')
    })

    it('restores pricing immutability inside the same bounded transaction', () => {
        expect(updateSql).toContain("SET LOCAL lock_timeout = '5s'")
        expect(updateSql).toContain('IN ACCESS EXCLUSIVE MODE')
        const disable = updateSql.indexOf('DISABLE TRIGGER enforce_payg_pricing_version_transition')
        const update = updateSql.indexOf('UPDATE billing.payg_pricing_versions')
        const enable = updateSql.indexOf('ENABLE TRIGGER enforce_payg_pricing_version_transition')
        expect(updateSql.indexOf('BEGIN;')).toBeLessThan(disable)
        expect(disable).toBeLessThan(update)
        expect(update).toBeLessThan(enable)
        expect(enable).toBeLessThan(updateSql.indexOf('COMMIT;'))
        expect(updateSql).toContain('fresh_payg_anchor_verification_failed')
    })
})
