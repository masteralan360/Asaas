-- `partner_name` is the sole active identity field for business partners.
-- The old `name` and `contact_name` values remain in place for historical
-- recovery and compatibility with already-installed clients, but application
-- code must not read or display either field.

ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS partner_name text;

ALTER TABLE crm.customers
  ADD COLUMN IF NOT EXISTS partner_name text;

ALTER TABLE crm.suppliers
  ADD COLUMN IF NOT EXISTS partner_name text;

UPDATE crm.business_partners
SET partner_name = COALESCE(NULLIF(btrim(name), ''), 'Unnamed partner')
WHERE partner_name IS NULL OR btrim(partner_name) = '';

UPDATE crm.customers
SET partner_name = COALESCE(NULLIF(btrim(name), ''), 'Unnamed partner')
WHERE partner_name IS NULL OR btrim(partner_name) = '';

UPDATE crm.suppliers
SET partner_name = COALESCE(NULLIF(btrim(name), ''), 'Unnamed partner')
WHERE partner_name IS NULL OR btrim(partner_name) = '';

ALTER TABLE crm.business_partners
  ALTER COLUMN partner_name SET NOT NULL;

ALTER TABLE crm.customers
  ALTER COLUMN partner_name SET NOT NULL;

ALTER TABLE crm.suppliers
  ALTER COLUMN partner_name SET NOT NULL;

CREATE OR REPLACE FUNCTION crm.keep_partner_name_compatibility_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.partner_name := NULLIF(btrim(COALESCE(NEW.partner_name, NEW.name, '')), '');

  IF NEW.partner_name IS NULL THEN
    RAISE EXCEPTION 'partner_name is required';
  END IF;

  -- Legacy routines and released clients still require the old NOT NULL
  -- column. Keep it as a write-only compatibility mirror; Atlas reads the
  -- canonical partner_name column exclusively.
  NEW.name := NEW.partner_name;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS keep_business_partner_name_compatibility ON crm.business_partners;
CREATE TRIGGER keep_business_partner_name_compatibility
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW
  EXECUTE FUNCTION crm.keep_partner_name_compatibility_fields();

DROP TRIGGER IF EXISTS keep_customer_partner_name_compatibility ON crm.customers;
CREATE TRIGGER keep_customer_partner_name_compatibility
  BEFORE INSERT OR UPDATE ON crm.customers
  FOR EACH ROW
  EXECUTE FUNCTION crm.keep_partner_name_compatibility_fields();

DROP TRIGGER IF EXISTS keep_supplier_partner_name_compatibility ON crm.suppliers;
CREATE TRIGGER keep_supplier_partner_name_compatibility
  BEFORE INSERT OR UPDATE ON crm.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION crm.keep_partner_name_compatibility_fields();

COMMENT ON COLUMN crm.business_partners.partner_name IS
  'Canonical active partner identity. Use this field for all application behavior and presentation.';
COMMENT ON COLUMN crm.business_partners.name IS
  'Legacy compatibility mirror. Do not query or display from Atlas application code.';
COMMENT ON COLUMN crm.business_partners.contact_name IS
  'Historical contact metadata. Do not query, display, or update from Atlas application code.';
COMMENT ON COLUMN crm.customers.partner_name IS
  'Canonical active partner identity mirrored from crm.business_partners.';
COMMENT ON COLUMN crm.customers.name IS
  'Legacy compatibility mirror. Do not query or display from Atlas application code.';
COMMENT ON COLUMN crm.suppliers.partner_name IS
  'Canonical active partner identity mirrored from crm.business_partners.';
COMMENT ON COLUMN crm.suppliers.name IS
  'Legacy compatibility mirror. Do not query or display from Atlas application code.';
COMMENT ON COLUMN crm.suppliers.contact_name IS
  'Historical contact metadata. Do not query, display, or update from Atlas application code.';
