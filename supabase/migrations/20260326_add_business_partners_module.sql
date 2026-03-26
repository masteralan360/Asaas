CREATE TABLE IF NOT EXISTS crm.business_partners (
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
  customer_facet_id uuid NULL,
  supplier_facet_id uuid NULL,
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
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  sync_status text NULL DEFAULT 'synced'::text,
  version bigint NULL DEFAULT 1,
  is_deleted boolean NULL DEFAULT false,
  CONSTRAINT business_partners_role_check CHECK (
    role IN ('customer', 'supplier', 'both')
  ),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm.business_partner_merge_candidates (
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

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace
  ON crm.business_partners (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace_updated
  ON crm.business_partners (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_workspace_deleted
  ON crm.business_partners (workspace_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_role
  ON crm.business_partners (workspace_id, role);

CREATE INDEX IF NOT EXISTS idx_crm_business_partner_merge_candidates_workspace
  ON crm.business_partner_merge_candidates (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_business_partner_merge_candidates_workspace_status
  ON crm.business_partner_merge_candidates (workspace_id, status);

ALTER TABLE crm.customers
  ADD COLUMN IF NOT EXISTS business_partner_id uuid NULL;

ALTER TABLE crm.suppliers
  ADD COLUMN IF NOT EXISTS business_partner_id uuid NULL;

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS business_partner_id uuid NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS business_partner_id uuid NULL;

ALTER TABLE crm.travel_agency_sales
  ADD COLUMN IF NOT EXISTS business_partner_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_crm_customers_business_partner
  ON crm.customers (business_partner_id);

CREATE INDEX IF NOT EXISTS idx_crm_suppliers_business_partner
  ON crm.suppliers (business_partner_id);

CREATE INDEX IF NOT EXISTS idx_crm_sales_orders_business_partner
  ON crm.sales_orders (business_partner_id);

CREATE INDEX IF NOT EXISTS idx_crm_purchase_orders_business_partner
  ON crm.purchase_orders (business_partner_id);

CREATE INDEX IF NOT EXISTS idx_crm_travel_agency_sales_business_partner
  ON crm.travel_agency_sales (business_partner_id);

WITH inserted_customers AS (
  INSERT INTO crm.business_partners (
    workspace_id,
    name,
    email,
    phone,
    address,
    city,
    country,
    notes,
    default_currency,
    role,
    credit_limit,
    customer_facet_id,
    total_sales_orders,
    total_sales_value,
    receivable_balance,
    created_at,
    updated_at,
    sync_status,
    version,
    is_deleted
  )
  SELECT
    c.workspace_id,
    c.name,
    c.email,
    c.phone,
    c.address,
    c.city,
    c.country,
    c.notes,
    c.default_currency,
    'customer',
    COALESCE(c.credit_limit, 0),
    c.id,
    COALESCE(c.total_orders, 0),
    COALESCE(c.total_spent, 0),
    COALESCE(c.outstanding_balance, 0),
    COALESCE(c.created_at, now()),
    COALESCE(c.updated_at, now()),
    COALESCE(c.sync_status, 'synced'),
    COALESCE(c.version, 1),
    COALESCE(c.is_deleted, false)
  FROM crm.customers c
  WHERE c.business_partner_id IS NULL
  RETURNING id, customer_facet_id
)
UPDATE crm.customers c
SET business_partner_id = inserted_customers.id
FROM inserted_customers
WHERE c.id = inserted_customers.customer_facet_id;

WITH inserted_suppliers AS (
  INSERT INTO crm.business_partners (
    workspace_id,
    name,
    contact_name,
    email,
    phone,
    address,
    city,
    country,
    notes,
    default_currency,
    role,
    credit_limit,
    supplier_facet_id,
    total_purchase_orders,
    total_purchase_value,
    created_at,
    updated_at,
    sync_status,
    version,
    is_deleted
  )
  SELECT
    s.workspace_id,
    s.name,
    s.contact_name,
    s.email,
    s.phone,
    s.address,
    s.city,
    s.country,
    s.notes,
    s.default_currency,
    'supplier',
    COALESCE(s.credit_limit, 0),
    s.id,
    COALESCE(s.total_purchases, 0),
    COALESCE(s.total_spent, 0),
    COALESCE(s.created_at, now()),
    COALESCE(s.updated_at, now()),
    COALESCE(s.sync_status, 'synced'),
    COALESCE(s.version, 1),
    COALESCE(s.is_deleted, false)
  FROM crm.suppliers s
  WHERE s.business_partner_id IS NULL
  RETURNING id, supplier_facet_id
)
UPDATE crm.suppliers s
SET business_partner_id = inserted_suppliers.id
FROM inserted_suppliers
WHERE s.id = inserted_suppliers.supplier_facet_id;

UPDATE crm.sales_orders so
SET business_partner_id = c.business_partner_id
FROM crm.customers c
WHERE so.business_partner_id IS NULL
  AND so.customer_id = c.id
  AND c.business_partner_id IS NOT NULL;

UPDATE crm.purchase_orders po
SET business_partner_id = s.business_partner_id
FROM crm.suppliers s
WHERE po.business_partner_id IS NULL
  AND po.supplier_id = s.id
  AND s.business_partner_id IS NOT NULL;

UPDATE crm.travel_agency_sales tas
SET business_partner_id = s.business_partner_id
FROM crm.suppliers s
WHERE tas.business_partner_id IS NULL
  AND tas.supplier_id = s.id
  AND s.business_partner_id IS NOT NULL;

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_linked_party_type_check;

UPDATE public.loans l
SET linked_party_type = 'business_partner',
    linked_party_id = c.business_partner_id,
    linked_party_name = COALESCE(bp.name, l.linked_party_name)
FROM crm.customers c
LEFT JOIN crm.business_partners bp ON bp.id = c.business_partner_id
WHERE l.linked_party_type = 'customer'
  AND l.linked_party_id = c.id
  AND c.business_partner_id IS NOT NULL;

UPDATE public.loans
SET linked_party_type = NULL,
    linked_party_id = NULL,
    linked_party_name = NULL
WHERE linked_party_type = 'customer';

ALTER TABLE public.loans
  ADD CONSTRAINT loans_linked_party_type_check CHECK (
    linked_party_type IS NULL
    OR linked_party_type = 'business_partner'::text
  );

INSERT INTO crm.business_partner_merge_candidates (
  workspace_id,
  primary_partner_id,
  secondary_partner_id,
  merge_type,
  reason,
  confidence,
  status,
  created_at,
  updated_at,
  sync_status,
  version,
  is_deleted
)
SELECT
  customer_partner.workspace_id,
  customer_partner.id,
  supplier_partner.id,
  'customer_supplier',
  CONCAT_WS(
    ', ',
    CASE
      WHEN lower(regexp_replace(COALESCE(customer_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
         = lower(regexp_replace(COALESCE(supplier_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
      THEN 'matching name'
      ELSE NULL
    END,
    CASE
      WHEN COALESCE(NULLIF(lower(customer_partner.phone), ''), '~')
         = COALESCE(NULLIF(lower(supplier_partner.phone), ''), '~~')
      THEN 'matching phone'
      ELSE NULL
    END,
    CASE
      WHEN COALESCE(NULLIF(lower(customer_partner.email), ''), '~')
         = COALESCE(NULLIF(lower(supplier_partner.email), ''), '~~')
      THEN 'matching email'
      ELSE NULL
    END
  ),
  CASE
    WHEN lower(regexp_replace(COALESCE(customer_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
       = lower(regexp_replace(COALESCE(supplier_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
       AND (
         COALESCE(NULLIF(lower(customer_partner.phone), ''), '~')
         = COALESCE(NULLIF(lower(supplier_partner.phone), ''), '~~')
         OR COALESCE(NULLIF(lower(customer_partner.email), ''), '~')
         = COALESCE(NULLIF(lower(supplier_partner.email), ''), '~~')
       )
      THEN 0.98
    WHEN lower(regexp_replace(COALESCE(customer_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
       = lower(regexp_replace(COALESCE(supplier_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
      THEN 0.86
    ELSE 0.78
  END,
  'pending',
  now(),
  now(),
  'synced',
  1,
  false
FROM crm.business_partners customer_partner
JOIN crm.business_partners supplier_partner
  ON supplier_partner.workspace_id = customer_partner.workspace_id
 AND supplier_partner.id <> customer_partner.id
WHERE customer_partner.role IN ('customer', 'both')
  AND supplier_partner.role IN ('supplier', 'both')
  AND (
    lower(regexp_replace(COALESCE(customer_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
      = lower(regexp_replace(COALESCE(supplier_partner.name, ''), '[^a-z0-9]+', ' ', 'g'))
    OR (
      customer_partner.phone IS NOT NULL
      AND supplier_partner.phone IS NOT NULL
      AND lower(customer_partner.phone) = lower(supplier_partner.phone)
    )
    OR (
      customer_partner.email IS NOT NULL
      AND supplier_partner.email IS NOT NULL
      AND lower(customer_partner.email) = lower(supplier_partner.email)
    )
  )
ON CONFLICT (primary_partner_id, secondary_partner_id, merge_type)
DO UPDATE SET
  reason = EXCLUDED.reason,
  confidence = EXCLUDED.confidence,
  updated_at = now(),
  version = crm.business_partner_merge_candidates.version + 1;

ALTER TABLE crm.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.business_partner_merge_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_business_partners_select ON crm.business_partners;
CREATE POLICY crm_business_partners_select
  ON crm.business_partners
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partners_insert ON crm.business_partners;
CREATE POLICY crm_business_partners_insert
  ON crm.business_partners
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partners_update ON crm.business_partners;
CREATE POLICY crm_business_partners_update
  ON crm.business_partners
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partners_delete ON crm.business_partners;
CREATE POLICY crm_business_partners_delete
  ON crm.business_partners
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

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

NOTIFY pgrst, 'reload schema';
