CREATE TABLE crm.agent_commission_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES crm.agent_commission_plans(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_deleted boolean NOT NULL DEFAULT false CHECK (is_deleted = false)
);

CREATE INDEX agent_commission_memberships_workspace_idx ON crm.agent_commission_memberships (workspace_id);
CREATE INDEX agent_commission_memberships_agent_idx
  ON crm.agent_commission_memberships (agent_id, effective_from DESC) WHERE is_deleted = false;
CREATE INDEX agent_commission_memberships_plan_idx
  ON crm.agent_commission_memberships (plan_id) WHERE is_deleted = false;
CREATE INDEX agent_commission_memberships_assigned_by_idx ON crm.agent_commission_memberships (assigned_by);
CREATE INDEX agent_commission_memberships_ended_by_idx ON crm.agent_commission_memberships (ended_by);
CREATE UNIQUE INDEX agent_commission_memberships_one_active_idx
  ON crm.agent_commission_memberships (workspace_id, agent_id)
  WHERE effective_to IS NULL AND is_deleted = false;

ALTER TABLE crm.agent_commission_memberships ENABLE ROW LEVEL SECURITY;
