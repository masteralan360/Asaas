-- Storefront catalog rules: per-workspace inclusion/exclusion targets that
-- filter which products appear on the marketplace storefront.
--   rule_type      : 'inclusion' (only these products show) or 'exclusion'
--   price_book_id  : target price book, or NULL for native products
--                    (products not listed in any price book)
-- Rows are hard-deleted; deleting a price book cascades and removes its rule.

CREATE TABLE IF NOT EXISTS public.workspace_storefront_catalog_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('inclusion', 'exclusion')),
  price_book_id uuid REFERENCES public.price_books(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_storefront_catalog_rules_workspace
  ON public.workspace_storefront_catalog_rules (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_catalog_rules_native
  ON public.workspace_storefront_catalog_rules (workspace_id, rule_type)
  WHERE price_book_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_catalog_rules_price_book
  ON public.workspace_storefront_catalog_rules (workspace_id, rule_type, price_book_id)
  WHERE price_book_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_storefront_catalog_rule_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.price_book_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.price_books AS price_book
       WHERE price_book.id = NEW.price_book_id
         AND price_book.workspace_id = NEW.workspace_id
     )
  THEN
    RAISE EXCEPTION 'Storefront catalog rule must reference a price book in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_storefront_catalog_rule_workspace_links ON public.workspace_storefront_catalog_rules;
CREATE TRIGGER enforce_storefront_catalog_rule_workspace_links
BEFORE INSERT OR UPDATE ON public.workspace_storefront_catalog_rules
FOR EACH ROW
EXECUTE FUNCTION public.enforce_storefront_catalog_rule_workspace_links();

DROP TRIGGER IF EXISTS update_storefront_catalog_rules_updated_at ON public.workspace_storefront_catalog_rules;
CREATE TRIGGER update_storefront_catalog_rules_updated_at
BEFORE UPDATE ON public.workspace_storefront_catalog_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_storefront_catalog_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storefront_catalog_rules_select ON public.workspace_storefront_catalog_rules;
CREATE POLICY storefront_catalog_rules_select
  ON public.workspace_storefront_catalog_rules
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS storefront_catalog_rules_insert ON public.workspace_storefront_catalog_rules;
CREATE POLICY storefront_catalog_rules_insert
  ON public.workspace_storefront_catalog_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS storefront_catalog_rules_update ON public.workspace_storefront_catalog_rules;
CREATE POLICY storefront_catalog_rules_update
  ON public.workspace_storefront_catalog_rules
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS storefront_catalog_rules_delete ON public.workspace_storefront_catalog_rules;
CREATE POLICY storefront_catalog_rules_delete
  ON public.workspace_storefront_catalog_rules
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );