CREATE TABLE IF NOT EXISTS crm.agent_excluded_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_excluded_categories_agent_category_key UNIQUE (agent_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_excluded_categories_workspace_agent
  ON crm.agent_excluded_categories (workspace_id, agent_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_agent_excluded_categories_workspace_category
  ON crm.agent_excluded_categories (workspace_id, category_id)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION public.enforce_agent_excluded_category_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.agents agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Excluded category agent must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.categories category
    WHERE category.id = NEW.category_id
      AND category.workspace_id = NEW.workspace_id
      AND COALESCE(category.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Excluded category must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_agent_excluded_category_workspace ON crm.agent_excluded_categories;
CREATE TRIGGER enforce_agent_excluded_category_workspace
  BEFORE INSERT OR UPDATE OF workspace_id, agent_id, category_id
  ON crm.agent_excluded_categories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_excluded_category_workspace();

ALTER TABLE crm.agent_excluded_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_agent_excluded_categories_select ON crm.agent_excluded_categories;
CREATE POLICY crm_agent_excluded_categories_select
  ON crm.agent_excluded_categories
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspaces.plan::text FROM public.workspaces WHERE workspaces.id = agent_excluded_categories.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agent_excluded_categories_insert ON crm.agent_excluded_categories;
CREATE POLICY crm_agent_excluded_categories_insert
  ON crm.agent_excluded_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspaces.plan::text FROM public.workspaces WHERE workspaces.id = agent_excluded_categories.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agent_excluded_categories_update ON crm.agent_excluded_categories;
CREATE POLICY crm_agent_excluded_categories_update
  ON crm.agent_excluded_categories
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspaces.plan::text FROM public.workspaces WHERE workspaces.id = agent_excluded_categories.workspace_id),
      'agents'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspaces.plan::text FROM public.workspaces WHERE workspaces.id = agent_excluded_categories.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agent_excluded_categories_delete ON crm.agent_excluded_categories;
CREATE POLICY crm_agent_excluded_categories_delete
  ON crm.agent_excluded_categories
  FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspaces.plan::text FROM public.workspaces WHERE workspaces.id = agent_excluded_categories.workspace_id),
      'agents'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.agent_excluded_categories TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_is_excluded_from_product_category(
  p_workspace_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.products product
    JOIN crm.agents agent
      ON agent.workspace_id = product.workspace_id
     AND agent.linked_user_id = auth.uid()
     AND COALESCE(agent.is_deleted, false) = false
    JOIN crm.agent_excluded_categories exclusion
      ON exclusion.agent_id = agent.id
     AND exclusion.workspace_id = product.workspace_id
     AND exclusion.category_id = product.category_id
     AND COALESCE(exclusion.is_deleted, false) = false
    WHERE product.id = p_product_id
      AND product.workspace_id = p_workspace_id
      AND product.category_id IS NOT NULL
      AND COALESCE(product.is_deleted, false) = false
  );
$function$;

CREATE OR REPLACE FUNCTION public.enforce_agent_product_selection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Sale workspace not found for selected product';
  END IF;

  IF public.current_user_is_excluded_from_product_category(v_workspace_id, NEW.product_id) THEN
    RAISE EXCEPTION 'This product category is excluded for the current agent user'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_agent_product_selection ON public.sale_items;
CREATE TRIGGER enforce_agent_product_selection
  BEFORE INSERT OR UPDATE OF sale_id, product_id ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_product_selection();

GRANT EXECUTE ON FUNCTION public.current_user_is_excluded_from_product_category(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_agent_excluded_category_workspace() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_agent_product_selection() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
