-- Partner directory reads are intentionally projected through RPCs so that a
-- mixed customer/supplier record cannot expose supplier fields to staff. The
-- normal REST upsert path cannot be used for writes because Postgres requires
-- a selectable row for UPDATE, while direct SELECT is deliberately revoked.
-- These RPCs keep the same privacy checks at the write boundary and return no
-- row data.

CREATE OR REPLACE FUNCTION crm.assert_partner_sync_payload_columns(
  p_table regclass,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_unknown_columns text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Partner sync payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(quote_ident(payload.key), ', ' ORDER BY payload.key)
  INTO v_unknown_columns
  FROM jsonb_object_keys(p_payload) AS payload(key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = p_table
      AND attribute.attname = payload.key
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  );

  IF v_unknown_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Partner sync payload contains unsupported column(s): %', v_unknown_columns
      USING ERRCODE = '42703';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.sync_business_partner(
  p_operation text,
  p_entity_id uuid,
  p_workspace_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, pg_temp
AS $function$
DECLARE
  v_existing crm.business_partners%ROWTYPE;
  v_next crm.business_partners%ROWTYPE;
  v_is_service boolean := auth.role() = 'service_role';
  v_scope text;
BEGIN
  IF p_entity_id IS NULL OR p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Business partner sync requires an entity and workspace id' USING ERRCODE = '22023';
  END IF;
  IF p_operation NOT IN ('upsert', 'soft_delete') THEN
    RAISE EXCEPTION 'Unsupported business partner sync operation: %', p_operation USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_service AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to sync business partners' USING ERRCODE = '42501';
  END IF;
  IF NOT v_is_service AND p_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM crm.business_partners
  WHERE id = p_entity_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'Business partner belongs to a different workspace' USING ERRCODE = '42501';
    END IF;

    v_scope := CASE WHEN v_existing.role = 'supplier' THEN 'supplier' ELSE 'customer' END;
    IF NOT v_is_service
      AND NOT crm.can_manage_business_partner(v_existing.workspace_id, v_existing.id, v_scope) THEN
      RAISE EXCEPTION 'Business partner access denied' USING ERRCODE = '42501';
    END IF;

    IF p_operation = 'soft_delete' THEN
      UPDATE crm.business_partners
      SET is_deleted = true,
          updated_at = now()
      WHERE id = p_entity_id;
      RETURN;
    END IF;

    PERFORM crm.assert_partner_sync_payload_columns('crm.business_partners'::regclass, p_payload);
    v_next := jsonb_populate_record(v_existing, p_payload);

    IF v_next.id IS DISTINCT FROM p_entity_id OR v_next.workspace_id IS DISTINCT FROM v_existing.workspace_id THEN
      RAISE EXCEPTION 'Business partner identity and workspace cannot change during sync' USING ERRCODE = '42501';
    END IF;
    IF v_next.role = 'agent'
      AND NOT (
        public.workspace_module_allowed(
          p_workspace_id,
          (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = p_workspace_id),
          'agents'
        )
        OR delivery.module_allowed(p_workspace_id)
      ) THEN
      RAISE EXCEPTION 'Agents module is not available in this workspace' USING ERRCODE = '42501';
    END IF;

    UPDATE crm.business_partners
    SET partner_name = v_next.partner_name,
        name = v_next.name,
        contact_name = v_next.contact_name,
        phone = v_next.phone,
        address = v_next.address,
        city = v_next.city,
        notes = v_next.notes,
        default_currency = v_next.default_currency,
        role = v_next.role,
        credit_limit = v_next.credit_limit,
        receivable_credit_limit = v_next.receivable_credit_limit,
        payable_credit_limit = v_next.payable_credit_limit,
        customer_facet_id = v_next.customer_facet_id,
        supplier_facet_id = v_next.supplier_facet_id,
        agent_facet_id = v_next.agent_facet_id,
        price_book_id = v_next.price_book_id,
        total_sales_orders = v_next.total_sales_orders,
        total_sales_value = v_next.total_sales_value,
        receivable_balance = v_next.receivable_balance,
        total_purchase_orders = v_next.total_purchase_orders,
        total_purchase_value = v_next.total_purchase_value,
        payable_balance = v_next.payable_balance,
        total_loan_count = v_next.total_loan_count,
        loan_outstanding_balance = v_next.loan_outstanding_balance,
        net_exposure = v_next.net_exposure,
        merged_into_business_partner_id = v_next.merged_into_business_partner_id,
        is_ecommerce = v_next.is_ecommerce,
        updated_at = COALESCE(v_next.updated_at, now()),
        version = v_next.version,
        is_deleted = v_next.is_deleted,
        latitude = v_next.latitude,
        longitude = v_next.longitude,
        staff_visibility = v_next.staff_visibility,
        owner_user_id = v_next.owner_user_id
    WHERE id = p_entity_id;
    RETURN;
  END IF;

  IF p_operation = 'soft_delete' THEN
    -- A retry after a successful delete is idempotent.
    RETURN;
  END IF;

  PERFORM crm.assert_partner_sync_payload_columns('crm.business_partners'::regclass, p_payload);
  v_next := jsonb_populate_record(NULL::crm.business_partners, p_payload);

  IF v_next.id IS DISTINCT FROM p_entity_id OR v_next.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'Business partner identity and workspace must match the sync request' USING ERRCODE = '42501';
  END IF;
  IF v_next.role = 'agent'
    AND NOT (
      public.workspace_module_allowed(
        p_workspace_id,
        (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = p_workspace_id),
        'agents'
      )
      OR delivery.module_allowed(p_workspace_id)
    ) THEN
    RAISE EXCEPTION 'Agents module is not available in this workspace' USING ERRCODE = '42501';
  END IF;

  v_next.sync_status := COALESCE(v_next.sync_status, 'synced');
  v_next.created_at := COALESCE(v_next.created_at, now());
  v_next.updated_at := COALESCE(v_next.updated_at, now());
  v_next.default_currency := COALESCE(v_next.default_currency, 'usd');
  v_next.role := COALESCE(v_next.role, 'customer');
  v_next.is_deleted := COALESCE(v_next.is_deleted, false);
  v_next.is_ecommerce := COALESCE(v_next.is_ecommerce, false);
  v_next.version := COALESCE(v_next.version, 1);
  v_next.staff_visibility := COALESCE(v_next.staff_visibility, 'shared');

  INSERT INTO crm.business_partners (
    id, workspace_id, partner_name, name, contact_name, phone, address, city, notes,
    default_currency, role, credit_limit, receivable_credit_limit, payable_credit_limit,
    customer_facet_id, supplier_facet_id, agent_facet_id, price_book_id,
    total_sales_orders, total_sales_value, receivable_balance,
    total_purchase_orders, total_purchase_value, payable_balance,
    total_loan_count, loan_outstanding_balance, net_exposure,
    merged_into_business_partner_id, is_ecommerce, created_at, updated_at, sync_status,
    version, is_deleted, latitude, longitude, staff_visibility, owner_user_id
  ) VALUES (
    v_next.id, v_next.workspace_id, v_next.partner_name, v_next.name, v_next.contact_name,
    v_next.phone, v_next.address, v_next.city, v_next.notes, v_next.default_currency,
    v_next.role, v_next.credit_limit, v_next.receivable_credit_limit,
    v_next.payable_credit_limit, v_next.customer_facet_id, v_next.supplier_facet_id,
    v_next.agent_facet_id, v_next.price_book_id, v_next.total_sales_orders,
    v_next.total_sales_value, v_next.receivable_balance, v_next.total_purchase_orders,
    v_next.total_purchase_value, v_next.payable_balance, v_next.total_loan_count,
    v_next.loan_outstanding_balance, v_next.net_exposure, v_next.merged_into_business_partner_id,
    v_next.is_ecommerce, v_next.created_at, v_next.updated_at, v_next.sync_status,
    v_next.version, v_next.is_deleted, v_next.latitude, v_next.longitude,
    v_next.staff_visibility, v_next.owner_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.sync_customer(
  p_operation text,
  p_entity_id uuid,
  p_workspace_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, pg_temp
AS $function$
DECLARE
  v_existing crm.customers%ROWTYPE;
  v_next crm.customers%ROWTYPE;
  v_partner crm.business_partners%ROWTYPE;
  v_is_service boolean := auth.role() = 'service_role';
BEGIN
  IF p_entity_id IS NULL OR p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Customer sync requires an entity and workspace id' USING ERRCODE = '22023';
  END IF;
  IF p_operation NOT IN ('upsert', 'soft_delete') THEN
    RAISE EXCEPTION 'Unsupported customer sync operation: %', p_operation USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_service AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to sync customers' USING ERRCODE = '42501';
  END IF;
  IF NOT v_is_service AND p_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM crm.customers WHERE id = p_entity_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'Customer belongs to a different workspace' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_service AND (
      v_existing.business_partner_id IS NULL
      OR NOT crm.can_manage_business_partner(v_existing.workspace_id, v_existing.business_partner_id, 'customer')
    ) THEN
      RAISE EXCEPTION 'Customer access denied' USING ERRCODE = '42501';
    END IF;
    IF p_operation = 'soft_delete' THEN
      UPDATE crm.customers SET is_deleted = true, updated_at = now() WHERE id = p_entity_id;
      RETURN;
    END IF;

    PERFORM crm.assert_partner_sync_payload_columns('crm.customers'::regclass, p_payload);
    v_next := jsonb_populate_record(v_existing, p_payload);
    IF v_next.id IS DISTINCT FROM p_entity_id
      OR v_next.workspace_id IS DISTINCT FROM v_existing.workspace_id
      OR v_next.business_partner_id IS DISTINCT FROM v_existing.business_partner_id THEN
      RAISE EXCEPTION 'Customer identity, workspace, and partner link cannot change during sync' USING ERRCODE = '42501';
    END IF;

    UPDATE crm.customers
    SET partner_name = v_next.partner_name,
        name = v_next.name,
        phone = v_next.phone,
        address = v_next.address,
        city = v_next.city,
        notes = v_next.notes,
        default_currency = v_next.default_currency,
        total_orders = v_next.total_orders,
        total_spent = v_next.total_spent,
        outstanding_balance = v_next.outstanding_balance,
        updated_at = COALESCE(v_next.updated_at, now()),
        version = v_next.version,
        is_deleted = v_next.is_deleted,
        credit_limit = v_next.credit_limit,
        is_ecommerce = v_next.is_ecommerce
    WHERE id = p_entity_id;
    RETURN;
  END IF;

  IF p_operation = 'soft_delete' THEN
    RETURN;
  END IF;

  PERFORM crm.assert_partner_sync_payload_columns('crm.customers'::regclass, p_payload);
  v_next := jsonb_populate_record(NULL::crm.customers, p_payload);
  IF v_next.id IS DISTINCT FROM p_entity_id
    OR v_next.workspace_id IS DISTINCT FROM p_workspace_id
    OR v_next.business_partner_id IS NULL THEN
    RAISE EXCEPTION 'Customer identity, workspace, and partner link must match the sync request' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_partner FROM crm.business_partners WHERE id = v_next.business_partner_id;
  IF NOT FOUND OR v_partner.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'Customer must reference a business partner in the same workspace' USING ERRCODE = '23514';
  END IF;
  IF NOT v_is_service AND NOT crm.can_manage_business_partner(p_workspace_id, v_next.business_partner_id, 'customer') THEN
    RAISE EXCEPTION 'Customer access denied' USING ERRCODE = '42501';
  END IF;

  v_next.sync_status := COALESCE(v_next.sync_status, 'synced');
  v_next.created_at := COALESCE(v_next.created_at, now());
  v_next.updated_at := COALESCE(v_next.updated_at, now());
  v_next.default_currency := COALESCE(v_next.default_currency, 'usd');
  v_next.is_deleted := COALESCE(v_next.is_deleted, false);
  v_next.is_ecommerce := COALESCE(v_next.is_ecommerce, false);
  v_next.version := COALESCE(v_next.version, 1);

  INSERT INTO crm.customers (
    id, workspace_id, business_partner_id, partner_name, name, phone, address, city,
    notes, default_currency, total_orders, total_spent, outstanding_balance,
    created_at, updated_at, sync_status, version, is_deleted, credit_limit, is_ecommerce
  ) VALUES (
    v_next.id, v_next.workspace_id, v_next.business_partner_id, v_next.partner_name,
    v_next.name, v_next.phone, v_next.address, v_next.city, v_next.notes,
    v_next.default_currency, v_next.total_orders, v_next.total_spent,
    v_next.outstanding_balance, v_next.created_at, v_next.updated_at,
    v_next.sync_status, v_next.version, v_next.is_deleted, v_next.credit_limit,
    v_next.is_ecommerce
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.sync_supplier(
  p_operation text,
  p_entity_id uuid,
  p_workspace_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, pg_temp
AS $function$
DECLARE
  v_existing crm.suppliers%ROWTYPE;
  v_next crm.suppliers%ROWTYPE;
  v_partner crm.business_partners%ROWTYPE;
  v_is_service boolean := auth.role() = 'service_role';
BEGIN
  IF p_entity_id IS NULL OR p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Supplier sync requires an entity and workspace id' USING ERRCODE = '22023';
  END IF;
  IF p_operation NOT IN ('upsert', 'soft_delete') THEN
    RAISE EXCEPTION 'Unsupported supplier sync operation: %', p_operation USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_service AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to sync suppliers' USING ERRCODE = '42501';
  END IF;
  IF NOT v_is_service AND p_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM crm.suppliers WHERE id = p_entity_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'Supplier belongs to a different workspace' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_service AND (
      v_existing.business_partner_id IS NULL
      OR NOT crm.can_manage_business_partner(v_existing.workspace_id, v_existing.business_partner_id, 'supplier')
    ) THEN
      RAISE EXCEPTION 'Supplier access denied' USING ERRCODE = '42501';
    END IF;
    IF p_operation = 'soft_delete' THEN
      UPDATE crm.suppliers SET is_deleted = true, updated_at = now() WHERE id = p_entity_id;
      RETURN;
    END IF;

    PERFORM crm.assert_partner_sync_payload_columns('crm.suppliers'::regclass, p_payload);
    v_next := jsonb_populate_record(v_existing, p_payload);
    IF v_next.id IS DISTINCT FROM p_entity_id
      OR v_next.workspace_id IS DISTINCT FROM v_existing.workspace_id
      OR v_next.business_partner_id IS DISTINCT FROM v_existing.business_partner_id THEN
      RAISE EXCEPTION 'Supplier identity, workspace, and partner link cannot change during sync' USING ERRCODE = '42501';
    END IF;

    UPDATE crm.suppliers
    SET partner_name = v_next.partner_name,
        name = v_next.name,
        contact_name = v_next.contact_name,
        phone = v_next.phone,
        address = v_next.address,
        city = v_next.city,
        default_currency = v_next.default_currency,
        notes = v_next.notes,
        total_purchases = v_next.total_purchases,
        total_spent = v_next.total_spent,
        updated_at = COALESCE(v_next.updated_at, now()),
        version = v_next.version,
        is_deleted = v_next.is_deleted,
        credit_limit = v_next.credit_limit,
        is_ecommerce = v_next.is_ecommerce
    WHERE id = p_entity_id;
    RETURN;
  END IF;

  IF p_operation = 'soft_delete' THEN
    RETURN;
  END IF;

  PERFORM crm.assert_partner_sync_payload_columns('crm.suppliers'::regclass, p_payload);
  v_next := jsonb_populate_record(NULL::crm.suppliers, p_payload);
  IF v_next.id IS DISTINCT FROM p_entity_id
    OR v_next.workspace_id IS DISTINCT FROM p_workspace_id
    OR v_next.business_partner_id IS NULL THEN
    RAISE EXCEPTION 'Supplier identity, workspace, and partner link must match the sync request' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_partner FROM crm.business_partners WHERE id = v_next.business_partner_id;
  IF NOT FOUND OR v_partner.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'Supplier must reference a business partner in the same workspace' USING ERRCODE = '23514';
  END IF;
  IF NOT v_is_service AND NOT crm.can_manage_business_partner(p_workspace_id, v_next.business_partner_id, 'supplier') THEN
    RAISE EXCEPTION 'Supplier access denied' USING ERRCODE = '42501';
  END IF;

  v_next.sync_status := COALESCE(v_next.sync_status, 'synced');
  v_next.created_at := COALESCE(v_next.created_at, now());
  v_next.updated_at := COALESCE(v_next.updated_at, now());
  v_next.default_currency := COALESCE(v_next.default_currency, 'usd');
  v_next.is_deleted := COALESCE(v_next.is_deleted, false);
  v_next.is_ecommerce := COALESCE(v_next.is_ecommerce, false);
  v_next.version := COALESCE(v_next.version, 1);

  INSERT INTO crm.suppliers (
    id, workspace_id, business_partner_id, partner_name, name, contact_name, phone,
    address, city, default_currency, notes, total_purchases, total_spent,
    created_at, updated_at, sync_status, version, is_deleted, credit_limit, is_ecommerce
  ) VALUES (
    v_next.id, v_next.workspace_id, v_next.business_partner_id, v_next.partner_name,
    v_next.name, v_next.contact_name, v_next.phone, v_next.address, v_next.city,
    v_next.default_currency, v_next.notes, v_next.total_purchases, v_next.total_spent,
    v_next.created_at, v_next.updated_at, v_next.sync_status, v_next.version,
    v_next.is_deleted, v_next.credit_limit, v_next.is_ecommerce
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.assert_partner_sync_payload_columns(regclass, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.sync_business_partner(text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.sync_customer(text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.sync_supplier(text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.sync_business_partner(text, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.sync_customer(text, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.sync_supplier(text, uuid, uuid, jsonb) TO authenticated, service_role;
