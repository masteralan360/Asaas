CREATE TABLE crm.business_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  contact_name text NULL,
  email text NULL,
  phone text NULL,
  address text NULL,
  city text NULL,
  country text NULL,
  notes text NULL,
  default_currency text NOT NULL DEFAULT 'usd'::text,
  role text NOT NULL DEFAULT 'customer'::text,
  credit_limit numeric NULL DEFAULT 0,
  receivable_credit_limit numeric NULL,
  payable_credit_limit numeric NULL,
  customer_facet_id uuid NULL,
  supplier_facet_id uuid NULL,
  agent_facet_id uuid NULL,
  price_book_id uuid NULL,
  total_sales_orders numeric NULL DEFAULT 0,
  total_sales_value numeric NULL DEFAULT 0,
  receivable_balance numeric NULL DEFAULT 0,
  total_purchase_orders numeric NULL DEFAULT 0,
  total_purchase_value numeric NULL DEFAULT 0,
  payable_balance numeric NULL DEFAULT 0,
  total_loan_count numeric NULL DEFAULT 0,
  loan_outstanding_balance numeric NULL DEFAULT 0,
  net_exposure numeric NULL DEFAULT 0,
  merged_into_business_partner_id uuid NULL,
  is_ecommerce boolean NULL DEFAULT false,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  sync_status text NULL DEFAULT 'synced'::text,
  version bigint NULL DEFAULT 1,
  is_deleted boolean NULL DEFAULT false,
  CONSTRAINT business_partners_role_check CHECK (
    role IN ('customer', 'supplier', 'both', 'agent', 'buyer', 'seller')
  ),
  CONSTRAINT business_partners_price_book_id_fkey
    FOREIGN KEY (price_book_id) REFERENCES public.price_books(id) ON DELETE SET NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace
  ON crm.business_partners (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace_updated
  ON crm.business_partners (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace_deleted
  ON crm.business_partners (workspace_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_role
  ON crm.business_partners (workspace_id, role);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_price_book
  ON crm.business_partners (price_book_id);

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partner_price_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.price_book_id IS NOT DISTINCT FROM OLD.price_book_id
    AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.price_book_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace.plan::text
  INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = NEW.workspace_id
    AND workspace.deleted_at IS NULL;

  IF v_plan IS NULL
    OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'priceBooks')
  THEN
    RAISE EXCEPTION 'Price Books capability is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_books AS price_book
    WHERE price_book.id = NEW.price_book_id
      AND price_book.workspace_id = NEW.workspace_id
      AND price_book.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Business partner price book must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_crm_business_partner_price_book ON crm.business_partners;
CREATE TRIGGER enforce_crm_business_partner_price_book
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_business_partner_price_book();

ALTER TABLE crm.business_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_business_partners_select ON crm.business_partners;
CREATE POLICY crm_business_partners_select
  ON crm.business_partners
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_insert ON crm.business_partners;
CREATE POLICY crm_business_partners_insert
  ON crm.business_partners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_update ON crm.business_partners;
CREATE POLICY crm_business_partners_update
  ON crm.business_partners
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_delete ON crm.business_partners;
CREATE POLICY crm_business_partners_delete
  ON crm.business_partners
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );
