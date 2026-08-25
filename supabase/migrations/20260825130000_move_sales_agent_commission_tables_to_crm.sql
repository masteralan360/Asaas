-- Sales Agent Commission CRM Schema Move
--
-- Moves the optional Sales Agent Commissions data into the same CRM schema as
-- agents and sales orders. ALTER TABLE ... SET SCHEMA preserves the existing
-- rows, indexes, constraints, triggers, RLS policies, and table grants.

-- Keep the migration safe to rerun if an SQL-editor execution reached this
-- point before a later statement failed.
DO $do$
DECLARE
  table_name text;
  public_relation regclass;
  crm_relation regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_commission_entries',
    'sales_order_agent_assignments',
    'agent_commission_memberships',
    'agent_commission_plans'
  ]
  LOOP
    public_relation := to_regclass(format('public.%I', table_name));
    crm_relation := to_regclass(format('crm.%I', table_name));

    IF public_relation IS NOT NULL AND crm_relation IS NOT NULL THEN
      RAISE EXCEPTION 'Both public.% and crm.% exist; resolve the duplicate before moving the commission tables',
        table_name, table_name;
    ELSIF public_relation IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA crm', table_name);
    END IF;
  END LOOP;
END;
$do$;

-- Existing private/public functions keep their source text when a referenced
-- table changes schema. Recreate only the affected definitions so every
-- relation reference resolves through crm rather than a now-missing public
-- table. Function identity, security attributes, ownership, and grants are
-- retained by CREATE OR REPLACE FUNCTION.
DO $do$
DECLARE
  function_definition text;
BEGIN
  FOR function_definition IN
    SELECT pg_get_functiondef(proc.oid)
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname IN ('private', 'public')
      AND proc.prokind = 'f'
      AND (
        position('public.agent_commission_entries' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.agent_commission_memberships' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.agent_commission_plans' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.sales_order_agent_assignments' IN pg_get_functiondef(proc.oid)) > 0
      )
  LOOP
    function_definition := replace(
      function_definition,
      'public.agent_commission_entries',
      'crm.agent_commission_entries'
    );
    function_definition := replace(
      function_definition,
      'public.agent_commission_memberships',
      'crm.agent_commission_memberships'
    );
    function_definition := replace(
      function_definition,
      'public.agent_commission_plans',
      'crm.agent_commission_plans'
    );
    function_definition := replace(
      function_definition,
      'public.sales_order_agent_assignments',
      'crm.sales_order_agent_assignments'
    );
    EXECUTE function_definition;
  END LOOP;
END;
$do$;

-- Reassert the existing private data/API posture after moving the relations.
ALTER TABLE crm.agent_commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.agent_commission_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.agent_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.sales_order_agent_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE crm.agent_commission_plans FROM anon;
REVOKE ALL ON TABLE crm.agent_commission_memberships FROM anon;
REVOKE ALL ON TABLE crm.sales_order_agent_assignments FROM anon;
REVOKE ALL ON TABLE crm.agent_commission_entries FROM anon;

REVOKE DELETE ON TABLE crm.agent_commission_plans FROM authenticated;
REVOKE DELETE ON TABLE crm.agent_commission_memberships FROM authenticated;
REVOKE DELETE ON TABLE crm.sales_order_agent_assignments FROM authenticated;
REVOKE DELETE ON TABLE crm.agent_commission_entries FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE crm.agent_commission_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE crm.agent_commission_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE crm.sales_order_agent_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE crm.agent_commission_entries TO authenticated;

GRANT ALL ON TABLE crm.agent_commission_plans TO service_role;
GRANT ALL ON TABLE crm.agent_commission_memberships TO service_role;
GRANT ALL ON TABLE crm.sales_order_agent_assignments TO service_role;
GRANT ALL ON TABLE crm.agent_commission_entries TO service_role;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'agent_commission_entries',
        'agent_commission_memberships',
        'agent_commission_plans',
        'sales_order_agent_assignments'
      )
  ) OR (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'crm'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'agent_commission_entries',
        'agent_commission_memberships',
        'agent_commission_plans',
        'sales_order_agent_assignments'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Sales Agent Commission tables were not fully moved to the crm schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname IN ('private', 'public')
      AND proc.prokind = 'f'
      AND (
        position('public.agent_commission_entries' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.agent_commission_memberships' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.agent_commission_plans' IN pg_get_functiondef(proc.oid)) > 0
        OR position('public.sales_order_agent_assignments' IN pg_get_functiondef(proc.oid)) > 0
      )
  ) THEN
    RAISE EXCEPTION 'Sales Agent Commission routines still reference the public schema';
  END IF;
END;
$do$;

NOTIFY pgrst, 'reload schema';
