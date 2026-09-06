import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  new URL('../../supabase/migrations/20260906010000_exempt_delivery_from_partner_privacy.sql', import.meta.url),
  'utf8',
)

describe('delivery partner privacy exemption migration', () => {
  it('removes the partner-visibility trigger and policies from every delivery record table', () => {
    for (const tableName of [
      'delivery_merchant_profiles',
      'delivery_shipments',
      'delivery_runs',
      'delivery_run_items',
      'delivery_shipment_events',
      'delivery_shipment_cod_adjustment_requests',
      'delivery_settlements',
      'delivery_ledger_entries',
    ]) {
      expect(migrationSql).toContain(`'${tableName}'`)
    }

    expect(migrationSql).toContain("'enforce_visible_partner_link_on_' || table_name")
    expect(migrationSql).toContain('DROP FUNCTION IF EXISTS delivery.enforce_visible_partner_link()')
    expect(migrationSql).toContain('DROP FUNCTION IF EXISTS delivery.can_access_partner_linked_record(uuid, text, jsonb)')
  })

  it('restores Post Service access controls without a business-partner visibility check', () => {
    expect(migrationSql).toContain("current_user_has_view_own_permission('postService.view_own')")
    expect(migrationSql).toContain('delivery.can_upsert_assigned_shipment(id, workspace_id)')
    expect(migrationSql).not.toContain('crm.can_access_business_partner')
  })
})
