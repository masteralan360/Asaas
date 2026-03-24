CREATE TABLE IF NOT EXISTS crm.travel_agency_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sale_number text NOT NULL,
  sale_date date NOT NULL,
  tourist_count integer NOT NULL DEFAULT 1,
  tourists jsonb NOT NULL DEFAULT '[]'::jsonb,
  group_travel_plan jsonb NULL,
  group_name text NULL,
  group_revenue numeric NULL DEFAULT 0,
  supplier_id uuid NULL,
  supplier_name text NULL,
  supplier_cost numeric NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd'::text,
  travel_packages jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method text NOT NULL,
  receiver text NOT NULL,
  notes text NULL,
  is_paid boolean NULL DEFAULT false,
  paid_at timestamp with time zone NULL,
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

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
    SELECT workspace_id
    FROM public.profiles
    WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;

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
