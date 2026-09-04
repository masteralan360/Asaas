-- Retire the Travel Agency module and purge every persisted record it owned.
-- Payment-account movements are removed first because they retain a restrictive
-- foreign key to their underlying payment transaction.
WITH retired_movements AS (
  SELECT
    movement.workspace_id,
    movement.account_id,
    movement.currency,
    SUM(movement.delta_amount) AS delta_amount
  FROM payment_accounts.account_movements AS movement
  JOIN public.payment_transactions AS payment
    ON payment.id = movement.payment_transaction_id
  WHERE payment.source_module = 'travel_agency'
     OR payment.source_type = 'travel_agency_sale'
  GROUP BY movement.workspace_id, movement.account_id, movement.currency
)
UPDATE payment_accounts.account_balances AS balance
SET
  balance_amount = balance.balance_amount - retired_movements.delta_amount,
  updated_at = now(),
  version = balance.version + 1
FROM retired_movements
WHERE balance.workspace_id = retired_movements.workspace_id
  AND balance.account_id = retired_movements.account_id
  AND balance.currency = retired_movements.currency;

DELETE FROM payment_accounts.account_movements AS movement
USING public.payment_transactions AS payment
WHERE movement.payment_transaction_id = payment.id
  AND (
    payment.source_module = 'travel_agency'
    OR payment.source_type = 'travel_agency_sale'
  );

DELETE FROM public.payment_transactions
WHERE source_module = 'travel_agency'
   OR source_type = 'travel_agency_sale';

DELETE FROM public.workspace_permissions
WHERE module = 'travelAgency'
   OR key LIKE 'travelAgency.%';

DELETE FROM public.workspace_access_overrides
WHERE type = 'module'
  AND key = 'travel_agency';

DELETE FROM public.workspace_usage_record_sources
WHERE schema_name = 'crm'
  AND table_name = 'travel_agency_sales';

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_count integer;
  v_branch_count integer;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  NEW.plan := public.normalize_workspace_plan(NEW.plan);

  IF TG_OP = 'UPDATE' AND NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    SELECT count(*) INTO v_member_count
    FROM public.profiles
    WHERE workspace_id = NEW.id;

    IF v_member_count > public.workspace_max_members(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace member count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_branch_count
    FROM public.workspace_branches
    WHERE source_workspace_id = NEW.id
      AND archived_at IS NULL;

    IF v_branch_count > public.workspace_max_branches(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace branch count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    v_max_contacts := public.workspace_max_contacts(NEW.id, NEW.plan);
    IF v_max_contacts IS NOT NULL THEN
      SELECT count(*) INTO v_contact_count
      FROM public.workspace_contacts
      WHERE workspace_id = NEW.id;

      IF v_contact_count > v_max_contacts THEN
        RAISE EXCEPTION 'Workspace contact count exceeds the % plan limit', NEW.plan
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    NEW.real_estate := public.workspace_module_allowed(NEW.id, NEW.plan::text, 'real_estate');
    NEW.allow_whatsapp := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'whatsappIntegration');
    NEW.upload_limit_mb := CASE
      WHEN public.workspace_has_override(NEW.id, 'limit', 'maxUploadSizeMb')
        THEN public.workspace_get_override_value(NEW.id, 'limit', 'maxUploadSizeMb')::integer
      ELSE CASE public.normalize_workspace_plan(NEW.plan::text)
        WHEN 'enterprise' THEN 1024
        WHEN 'business' THEN 100
        ELSE NULL
      END
    END;
  END IF;

  IF NOT public.workspace_currency_allowed(NEW.id, NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'iqd';
  END IF;

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
    DELETE FROM public.workspace_storefronts
    WHERE workspace_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS travel_agency;

DROP TABLE IF EXISTS crm.travel_agency_sales CASCADE;
