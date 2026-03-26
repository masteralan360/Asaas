CREATE TABLE crm.travel_agency_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sale_number text NOT NULL,
  sale_date date NOT NULL,
  tourist_count integer NOT NULL DEFAULT 1,
  tourists jsonb NOT NULL DEFAULT '[]'::jsonb,
  group_travel_plan jsonb NULL,
  group_name text NULL,
  group_revenue numeric NULL DEFAULT 0,
  business_partner_id uuid NULL,
  supplier_id uuid NULL,
  supplier_name text NULL,
  supplier_cost numeric NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd'::text,
  travel_packages jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method text NOT NULL,
  paid_amount numeric NULL DEFAULT 0,
  receiver text NOT NULL,
  notes text NULL,
  is_paid boolean NULL DEFAULT false,
  paid_at timestamp with time zone NULL,
  status text NULL DEFAULT 'completed'::text,
  exchange_rate_snapshot jsonb NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  sync_status text NULL DEFAULT 'synced'::text,
  version bigint NULL DEFAULT 1,
  is_deleted boolean NULL DEFAULT false,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_workspace
  ON crm.travel_agency_sales (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_workspace_updated
  ON crm.travel_agency_sales (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_workspace_deleted
  ON crm.travel_agency_sales (workspace_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_workspace_paid
  ON crm.travel_agency_sales (workspace_id, is_paid);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_workspace_date
  ON crm.travel_agency_sales (workspace_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_business_partner
  ON crm.travel_agency_sales (business_partner_id);

ALTER TABLE crm.travel_agency_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_travel_agency_sales_select ON crm.travel_agency_sales;
CREATE POLICY crm_travel_agency_sales_select
  ON crm.travel_agency_sales
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_travel_agency_sales_insert ON crm.travel_agency_sales;
CREATE POLICY crm_travel_agency_sales_insert
  ON crm.travel_agency_sales
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_travel_agency_sales_update ON crm.travel_agency_sales;
CREATE POLICY crm_travel_agency_sales_update
  ON crm.travel_agency_sales
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_travel_agency_sales_delete ON crm.travel_agency_sales;
CREATE POLICY crm_travel_agency_sales_delete
  ON crm.travel_agency_sales
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());
