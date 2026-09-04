-- Post Service / COD delivery operations. Merchants remain CRM business
-- partners; this schema contains only delivery-specific operational and
-- financial records.

CREATE SCHEMA IF NOT EXISTS delivery;

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN false
    WHEN 'kds' THEN false
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'agents' THEN false
    WHEN 'post_service' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION delivery.module_allowed(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces workspace
    WHERE workspace.id = p_workspace_id
      AND workspace.deleted_at IS NULL
      AND public.workspace_module_allowed(p_workspace_id, workspace.plan::text, 'post_service')
  );
$function$;

CREATE TABLE IF NOT EXISTS delivery.delivery_merchant_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_partner_id uuid NOT NULL REFERENCES crm.business_partners(id) ON DELETE RESTRICT,
  default_fee_amount numeric NOT NULL DEFAULT 0 CHECK (default_fee_amount >= 0),
  default_fee_payer text NOT NULL DEFAULT 'merchant' CHECK (default_fee_payer IN ('merchant', 'recipient')),
  default_pickup_address text NULL,
  payout_schedule text NOT NULL DEFAULT 'daily' CHECK (payout_schedule IN ('daily', 'weekly', 'on_request')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_merchant_profile_workspace_partner_unique UNIQUE (workspace_id, business_partner_id)
);

CREATE TABLE IF NOT EXISTS delivery.delivery_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tracking_number text NOT NULL,
  merchant_profile_id uuid NOT NULL REFERENCES delivery.delivery_merchant_profiles(id) ON DELETE RESTRICT,
  merchant_business_partner_id uuid NOT NULL REFERENCES crm.business_partners(id) ON DELETE RESTRICT,
  recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) > 0),
  recipient_phone text NOT NULL CHECK (char_length(btrim(recipient_phone)) > 0),
  recipient_alternate_phone text NULL,
  recipient_address text NOT NULL CHECK (char_length(btrim(recipient_address)) > 0),
  recipient_city text NULL,
  recipient_latitude double precision NULL CHECK (recipient_latitude IS NULL OR recipient_latitude BETWEEN -90 AND 90),
  recipient_longitude double precision NULL CHECK (recipient_longitude IS NULL OR recipient_longitude BETWEEN -180 AND 180),
  description text NULL,
  currency text NOT NULL DEFAULT 'iqd',
  cod_amount numeric NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  delivery_fee numeric NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  fee_payer text NOT NULL DEFAULT 'merchant' CHECK (fee_payer IN ('merchant', 'recipient')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'ready_for_dispatch', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled')),
  assigned_agent_id uuid NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  assigned_run_id uuid NULL,
  delivered_at timestamptz NULL,
  postponed_at timestamptz NULL,
  returned_at timestamptz NULL,
  status_note text NULL,
  source_sales_order_id uuid NULL REFERENCES crm.sales_orders(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_shipment_unique_tracking UNIQUE (workspace_id, tracking_number),
  CONSTRAINT delivery_shipment_assigned_check CHECK (
    status NOT IN ('assigned', 'delivered', 'postponed', 'returned') OR assigned_agent_id IS NOT NULL
  ),
  CONSTRAINT delivery_shipment_terminal_dates CHECK (
    (status <> 'delivered' OR delivered_at IS NOT NULL)
    AND (status <> 'returned' OR returned_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS delivery.delivery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_number text NOT NULL,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  vehicle_id uuid NULL REFERENCES fleet.fleet_vehicles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_run_unique_number UNIQUE (workspace_id, run_number),
  CONSTRAINT delivery_run_closed_check CHECK ((status <> 'closed') OR closed_at IS NOT NULL)
);

ALTER TABLE delivery.delivery_shipments
  DROP CONSTRAINT IF EXISTS delivery_shipments_assigned_run_id_fkey;
ALTER TABLE delivery.delivery_shipments
  ADD CONSTRAINT delivery_shipments_assigned_run_id_fkey
  FOREIGN KEY (assigned_run_id) REFERENCES delivery.delivery_runs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS delivery.delivery_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES delivery.delivery_runs(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_run_item_unique_shipment UNIQUE (run_id, shipment_id)
);

CREATE TABLE IF NOT EXISTS delivery.delivery_shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  previous_status text NULL CHECK (previous_status IS NULL OR previous_status IN ('received', 'ready_for_dispatch', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled')),
  status text NOT NULL CHECK (status IN ('received', 'ready_for_dispatch', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled')),
  note text NULL,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_agent_id uuid NULL REFERENCES crm.agents(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_shipment_event_reason_check CHECK (status NOT IN ('postponed', 'returned', 'cancelled') OR char_length(btrim(coalesce(note, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS delivery.delivery_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  settlement_number text NOT NULL,
  type text NOT NULL CHECK (type IN ('courier_remittance', 'merchant_payout')),
  agent_id uuid NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  merchant_profile_id uuid NULL REFERENCES delivery.delivery_merchant_profiles(id) ON DELETE RESTRICT,
  business_partner_id uuid NULL REFERENCES crm.business_partners(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'iqd',
  expected_amount numeric NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
  actual_amount numeric NOT NULL CHECK (actual_amount > 0),
  variance_amount numeric NOT NULL DEFAULT 0,
  variance_note text NULL,
  payment_method text NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  note text NULL,
  payment_transaction_id uuid NULL REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_settlement_unique_number UNIQUE (workspace_id, settlement_number),
  CONSTRAINT delivery_settlement_party_check CHECK (
    (type = 'courier_remittance' AND agent_id IS NOT NULL AND merchant_profile_id IS NULL)
    OR (type = 'merchant_payout' AND agent_id IS NULL AND merchant_profile_id IS NOT NULL AND business_partner_id IS NOT NULL)
  ),
  CONSTRAINT delivery_settlement_variance_reason_check CHECK (variance_amount = 0 OR char_length(btrim(coalesce(variance_note, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS delivery.delivery_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('courier_collection', 'courier_remittance', 'merchant_cod_payable', 'merchant_fee', 'merchant_payout', 'adjustment')),
  shipment_id uuid NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  settlement_id uuid NULL REFERENCES delivery.delivery_settlements(id) ON DELETE RESTRICT,
  agent_id uuid NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  merchant_profile_id uuid NULL REFERENCES delivery.delivery_merchant_profiles(id) ON DELETE RESTRICT,
  business_partner_id uuid NULL REFERENCES crm.business_partners(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount <> 0),
  currency text NOT NULL DEFAULT 'iqd',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_ledger_party_check CHECK (
    (kind IN ('courier_collection', 'courier_remittance') AND agent_id IS NOT NULL AND merchant_profile_id IS NULL)
    OR (kind IN ('merchant_cod_payable', 'merchant_fee', 'merchant_payout') AND merchant_profile_id IS NOT NULL AND agent_id IS NULL)
    OR kind = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS idx_delivery_profiles_workspace_active ON delivery.delivery_merchant_profiles (workspace_id, is_active) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_shipments_workspace_status ON delivery.delivery_shipments (workspace_id, status, updated_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_shipments_assigned_agent ON delivery.delivery_shipments (workspace_id, assigned_agent_id, updated_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_shipments_merchant ON delivery.delivery_shipments (workspace_id, merchant_profile_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_runs_agent ON delivery.delivery_runs (workspace_id, agent_id, dispatched_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_events_shipment ON delivery.delivery_shipment_events (shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_settlements_party ON delivery.delivery_settlements (workspace_id, agent_id, merchant_profile_id, settled_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_ledger_courier ON delivery.delivery_ledger_entries (workspace_id, agent_id, currency, occurred_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_delivery_ledger_merchant ON delivery.delivery_ledger_entries (workspace_id, merchant_profile_id, currency, occurred_at DESC) WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION delivery.assert_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, fleet, delivery
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'delivery_merchant_profiles' AND NOT EXISTS (
    SELECT 1 FROM crm.business_partners partner
    WHERE partner.id = NEW.business_partner_id AND partner.workspace_id = NEW.workspace_id AND COALESCE(partner.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Merchant must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'delivery_shipments' AND (
    NOT EXISTS (SELECT 1 FROM delivery.delivery_merchant_profiles profile WHERE profile.id = NEW.merchant_profile_id AND profile.workspace_id = NEW.workspace_id AND COALESCE(profile.is_deleted, false) = false)
    OR NOT EXISTS (SELECT 1 FROM crm.business_partners partner WHERE partner.id = NEW.merchant_business_partner_id AND partner.workspace_id = NEW.workspace_id AND COALESCE(partner.is_deleted, false) = false)
    OR (NEW.assigned_agent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm.agents agent WHERE agent.id = NEW.assigned_agent_id AND agent.workspace_id = NEW.workspace_id AND COALESCE(agent.is_deleted, false) = false))
  ) THEN
    RAISE EXCEPTION 'Shipment links must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'delivery_runs' AND (
    NOT EXISTS (SELECT 1 FROM crm.agents agent WHERE agent.id = NEW.agent_id AND agent.workspace_id = NEW.workspace_id AND COALESCE(agent.is_deleted, false) = false)
    OR (NEW.vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fleet.fleet_vehicles vehicle WHERE vehicle.id = NEW.vehicle_id AND vehicle.workspace_id = NEW.workspace_id AND COALESCE(vehicle.is_deleted, false) = false))
  ) THEN
    RAISE EXCEPTION 'Run links must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS delivery_profile_workspace_links ON delivery.delivery_merchant_profiles;
CREATE TRIGGER delivery_profile_workspace_links BEFORE INSERT OR UPDATE ON delivery.delivery_merchant_profiles FOR EACH ROW EXECUTE FUNCTION delivery.assert_workspace_links();
DROP TRIGGER IF EXISTS delivery_shipment_workspace_links ON delivery.delivery_shipments;
CREATE TRIGGER delivery_shipment_workspace_links BEFORE INSERT OR UPDATE ON delivery.delivery_shipments FOR EACH ROW EXECUTE FUNCTION delivery.assert_workspace_links();
DROP TRIGGER IF EXISTS delivery_run_workspace_links ON delivery.delivery_runs;
CREATE TRIGGER delivery_run_workspace_links BEFORE INSERT OR UPDATE ON delivery.delivery_runs FOR EACH ROW EXECUTE FUNCTION delivery.assert_workspace_links();

CREATE OR REPLACE FUNCTION delivery.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['delivery_merchant_profiles', 'delivery_shipments', 'delivery_runs', 'delivery_run_items', 'delivery_shipment_events', 'delivery_settlements', 'delivery_ledger_entries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_%s_updated_at ON delivery.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER touch_%s_updated_at BEFORE UPDATE ON delivery.%I FOR EACH ROW EXECUTE FUNCTION delivery.touch_updated_at()', table_name, table_name);
  END LOOP;
END;
$do$;

-- A courier is an Agent profile, not a duplicated master-data entity. It has
-- no mandatory vehicle because bike and foot couriers are valid operators.
ALTER TABLE crm.agents DROP CONSTRAINT IF EXISTS agents_type_check;
ALTER TABLE crm.agents ADD CONSTRAINT agents_type_check CHECK (agent_type IN ('driver', 'field_agent', 'courier'));

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partner_agent_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE v_plan text;
BEGIN
  IF NEW.role <> 'agent' THEN RETURN NEW; END IF;
  SELECT plan::text INTO v_plan FROM public.workspaces WHERE id = NEW.workspace_id AND deleted_at IS NULL;
  IF v_plan IS NULL OR NOT (
    public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agents')
    OR public.workspace_module_allowed(NEW.workspace_id, v_plan, 'post_service')
  ) THEN
    RAISE EXCEPTION 'Agent roles require Agents or Post Service access' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Post Service owns its own access, but may read/create its supporting agent
-- records without enabling the broader Agents module.
DROP POLICY IF EXISTS crm_agents_select ON crm.agents;
CREATE POLICY crm_agents_select ON crm.agents FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id() AND (
    public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id), 'agents')
    OR delivery.module_allowed(workspace_id)
  )
);
DROP POLICY IF EXISTS crm_agents_insert ON crm.agents;
CREATE POLICY crm_agents_insert ON crm.agents FOR INSERT TO authenticated WITH CHECK (
  workspace_id = public.current_workspace_id() AND (
    public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id), 'agents')
    OR delivery.module_allowed(workspace_id)
  )
);
DROP POLICY IF EXISTS crm_agents_update ON crm.agents;
CREATE POLICY crm_agents_update ON crm.agents FOR UPDATE TO authenticated USING (
  workspace_id = public.current_workspace_id() AND (
    public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id), 'agents')
    OR delivery.module_allowed(workspace_id)
  )
) WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partners_select ON crm.business_partners;
CREATE POLICY crm_business_partners_select ON crm.business_partners FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id() AND (
    role <> 'agent' OR public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id), 'agents') OR delivery.module_allowed(workspace_id)
  )
);
DROP POLICY IF EXISTS crm_business_partners_insert ON crm.business_partners;
CREATE POLICY crm_business_partners_insert ON crm.business_partners FOR INSERT TO authenticated WITH CHECK (
  workspace_id = public.current_workspace_id() AND (
    role <> 'agent' OR public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id), 'agents') OR delivery.module_allowed(workspace_id)
  )
);
DROP POLICY IF EXISTS crm_business_partners_update ON crm.business_partners;
CREATE POLICY crm_business_partners_update ON crm.business_partners FOR UPDATE TO authenticated USING (
  workspace_id = public.current_workspace_id() AND (
    role <> 'agent' OR public.workspace_module_allowed(workspace_id, (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id), 'agents') OR delivery.module_allowed(workspace_id)
  )
) WITH CHECK (workspace_id = public.current_workspace_id());

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['delivery_merchant_profiles', 'delivery_shipments', 'delivery_runs', 'delivery_run_items', 'delivery_shipment_events', 'delivery_settlements', 'delivery_ledger_entries'] LOOP
    EXECUTE format('ALTER TABLE delivery.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_read ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_write ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_update ON delivery.%I', table_name);
    EXECUTE format('CREATE POLICY delivery_read ON delivery.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id))', table_name);
    EXECUTE format('CREATE POLICY delivery_write ON delivery.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))', table_name);
    EXECUTE format('CREATE POLICY delivery_update ON delivery.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'')) WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))', table_name);
  END LOOP;
END;
$do$;

GRANT USAGE ON SCHEMA delivery TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA delivery TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delivery.module_allowed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
