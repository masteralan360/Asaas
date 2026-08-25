CREATE TABLE crm.agent_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  level text NOT NULL CHECK (NULLIF(btrim(level), '') IS NOT NULL),
  rate_percent numeric(9, 6) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  calculation_basis text NOT NULL DEFAULT 'net_profit' CHECK (calculation_basis IN ('net_profit', 'net_revenue')),
  include_tax boolean NOT NULL DEFAULT false,
  include_delivery_charge boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_commission_plans_name_check CHECK (NULLIF(btrim(name), '') IS NOT NULL)
);

COMMENT ON COLUMN crm.agent_commission_plans.level IS
  'Stable user-defined commission-level key. The matching name column is the user-visible level name.';

CREATE INDEX agent_commission_plans_workspace_idx ON crm.agent_commission_plans (workspace_id);
CREATE INDEX agent_commission_plans_workspace_level_idx
  ON crm.agent_commission_plans (workspace_id, level, effective_from DESC) WHERE is_deleted = false;
CREATE INDEX agent_commission_plans_created_by_idx ON crm.agent_commission_plans (created_by);
CREATE UNIQUE INDEX agent_commission_plans_one_per_level_idx
  ON crm.agent_commission_plans (workspace_id, level)
  WHERE is_deleted = false
    AND (is_active = true OR effective_to IS NULL);

ALTER TABLE crm.agent_commission_plans ENABLE ROW LEVEL SECURITY;
