-- A workspace chooses one commission-sheet structure. Tiers are saved as
-- metadata on each level now; they intentionally do not change calculations.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS sales_agent_commission_sheet_type text;

UPDATE public.workspaces
SET sales_agent_commission_sheet_type = 'normal'
WHERE sales_agent_commission_sheet_type IS NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN sales_agent_commission_sheet_type SET DEFAULT 'normal',
  ALTER COLUMN sales_agent_commission_sheet_type SET NOT NULL,
  DROP CONSTRAINT IF EXISTS workspaces_sales_agent_commission_sheet_type_check,
  ADD CONSTRAINT workspaces_sales_agent_commission_sheet_type_check CHECK (
    sales_agent_commission_sheet_type IN ('normal', 'tier_based')
  );

ALTER TABLE crm.agent_commission_plans
  ADD COLUMN IF NOT EXISTS tier_name text NULL;

ALTER TABLE crm.agent_commission_plans
  DROP CONSTRAINT IF EXISTS agent_commission_plans_tier_name_nonblank_check,
  ADD CONSTRAINT agent_commission_plans_tier_name_nonblank_check CHECK (
    tier_name IS NULL OR NULLIF(btrim(tier_name), '') IS NOT NULL
  );

COMMENT ON COLUMN public.workspaces.sales_agent_commission_sheet_type IS
  'Sales-agent commission sheet structure. Tier labels are informational until tier calculations are enabled.';
COMMENT ON COLUMN crm.agent_commission_plans.tier_name IS
  'Optional tier label for a tier-based sales-agent commission sheet. Informational until tier calculations are enabled.';

NOTIFY pgrst, 'reload schema';
