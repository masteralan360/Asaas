-- Commission levels are user-defined groups. `level` remains an immutable
-- grouping key so effective-dated revisions continue to belong to one level;
-- the user-facing name is stored in `name`.
ALTER TABLE crm.agent_commission_plans
  DROP CONSTRAINT IF EXISTS agent_commission_plans_level_check;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'crm.agent_commission_plans'::regclass
      AND conname = 'agent_commission_plans_level_nonblank_check'
  ) THEN
    ALTER TABLE crm.agent_commission_plans
      ADD CONSTRAINT agent_commission_plans_level_nonblank_check
      CHECK (NULLIF(btrim(level), '') IS NOT NULL);
  END IF;
END;
$do$;

COMMENT ON COLUMN crm.agent_commission_plans.level IS
  'Stable user-defined commission-level key. The matching name column is the user-visible level name.';

NOTIFY pgrst, 'reload schema';
