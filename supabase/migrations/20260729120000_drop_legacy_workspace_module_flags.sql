-- Workspace module access is now derived from the workspace plan plus
-- workspace_access_overrides. These original CRM module flags are no longer
-- read by the application or enforced by database access rules.
ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS allow_crm,
  DROP COLUMN IF EXISTS allow_customers,
  DROP COLUMN IF EXISTS allow_orders,
  DROP COLUMN IF EXISTS allow_suppliers;
