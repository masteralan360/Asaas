import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  new URL('../../supabase/migrations/20260906010100_allow_database_admin_delivery_overrides.sql', import.meta.url),
  'utf8',
)

describe('delivery database-admin override migration', () => {
  it('allows dashboard and service-role corrections without an Atlas identity', () => {
    expect(migrationSql).toContain("IF auth.uid() IS NULL OR public.current_user_role() = 'admin' THEN")
    expect(migrationSql).toContain('IF auth.uid() IS NULL THEN\n    RETURN NEW;')
  })

  it('retains the commercial and COD guards for authenticated non-admin users', () => {
    expect(migrationSql).toContain("NEW.cod_amount IS DISTINCT FROM OLD.cod_amount")
    expect(migrationSql).toContain("RAISE EXCEPTION 'Only an administrator can edit and redispatch a post'")
    expect(migrationSql).toContain("RAISE EXCEPTION 'Only an administrator can approve a COD change'")
  })
})
