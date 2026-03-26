CREATE TABLE crm.business_partner_merge_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  primary_partner_id uuid NOT NULL,
  secondary_partner_id uuid NOT NULL,
  merge_type text NOT NULL DEFAULT 'customer_supplier'::text,
  reason text NULL,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  sync_status text NULL DEFAULT 'synced'::text,
  version bigint NULL DEFAULT 1,
  is_deleted boolean NULL DEFAULT false,
  CONSTRAINT business_partner_merge_candidates_type_check CHECK (
    merge_type IN ('customer_supplier')
  ),
  CONSTRAINT business_partner_merge_candidates_status_check CHECK (
    status IN ('pending', 'accepted', 'dismissed')
  ),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_business_partner_merge_candidates_unique
  ON crm.business_partner_merge_candidates (primary_partner_id, secondary_partner_id, merge_type);

CREATE INDEX IF NOT EXISTS idx_crm_business_partner_merge_candidates_workspace
  ON crm.business_partner_merge_candidates (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_business_partner_merge_candidates_workspace_status
  ON crm.business_partner_merge_candidates (workspace_id, status);

ALTER TABLE crm.business_partner_merge_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_business_partner_merge_candidates_select ON crm.business_partner_merge_candidates;
CREATE POLICY crm_business_partner_merge_candidates_select
  ON crm.business_partner_merge_candidates
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partner_merge_candidates_insert ON crm.business_partner_merge_candidates;
CREATE POLICY crm_business_partner_merge_candidates_insert
  ON crm.business_partner_merge_candidates
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partner_merge_candidates_update ON crm.business_partner_merge_candidates;
CREATE POLICY crm_business_partner_merge_candidates_update
  ON crm.business_partner_merge_candidates
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partner_merge_candidates_delete ON crm.business_partner_merge_candidates;
CREATE POLICY crm_business_partner_merge_candidates_delete
  ON crm.business_partner_merge_candidates
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());
