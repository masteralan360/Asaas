-- Retire the business-partner email and country fields. This migration depends
-- on 20260902100000_make_partner_name_canonical.sql, whose compatibility
-- trigger supplies partner_name to the legacy marketplace insert routine.

-- The delivered-marketplace procedure is the only active CRM routine that
-- still reads/writes these fields. Redefine that deployed procedure before
-- dropping the columns. pg_get_functiondef normalizes whitespace, so these
-- replacements deliberately match SQL structure rather than source formatting.
DO $migration$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.transition_marketplace_order(uuid,text,text)'::regprocedure
  )
  INTO definition;

  IF definition IS NULL
    OR position('v_email_norm' IN definition) = 0
    OR position('bp.email' IN definition) = 0 THEN
    RAISE EXCEPTION
      'Expected marketplace delivery procedure revision is not installed; email/country retirement was not applied.';
  END IF;

  -- Remove email declaration, normalization, matching and sort preference.
  definition := regexp_replace(
    definition,
    $regex$(?m)^\s*v_email_norm\s+text;\s*\n$regex$,
    '',
    'g'
  );
  definition := regexp_replace(
    definition,
    $regex$(?m)^\s*v_email_norm\s*:=.*;\s*\n$regex$,
    '',
    'g'
  );
  definition := regexp_replace(
    definition,
    $regex$\s+OR\s+\(v_email_norm IS NOT NULL AND lower\(trim\(COALESCE\(bp\.email, ''\)\)\) = v_email_norm\)$regex$,
    '',
    'g'
  );
  definition := regexp_replace(
    definition,
    $regex$,\s*CASE\s+WHEN\s+v_email_norm IS NOT NULL AND lower\(trim\(COALESCE\(bp\.email, ''\)\)\) = v_email_norm THEN 0\s+ELSE 1\s+END$regex$,
    '',
    'g'
  );

  -- Remove the CRM columns and their marketplace order values. Country is
  -- always the NULL value immediately after customer_city in this routine.
  definition := regexp_replace(definition, $regex$(?m)^\s*email,\s*\n$regex$, '', 'g');
  definition := regexp_replace(definition, $regex$(?m)^\s*country,\s*\n$regex$, '', 'g');
  definition := regexp_replace(definition, $regex$(?m)^\s*v_order\.customer_email,\s*\n$regex$, '', 'g');
  definition := regexp_replace(
    definition,
    $regex$(v_order\.customer_city,\s*\n)\s*NULL,\s*\n$regex$,
    $replacement$\1$replacement$,
    'g'
  );

  IF position('email' IN lower(definition)) > 0
    OR position('country' IN lower(definition)) > 0 THEN
    RAISE EXCEPTION
      'Marketplace delivery procedure still refers to retired partner fields; email/country retirement was not applied.';
  END IF;

  EXECUTE definition;
END;
$migration$;

ALTER TABLE crm.business_partners
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS country;

ALTER TABLE crm.customers
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS country;

ALTER TABLE crm.suppliers
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS country;
