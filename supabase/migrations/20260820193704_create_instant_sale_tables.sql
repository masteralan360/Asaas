-- A table assignment belongs to an Instant POS sale but is not a sales-domain
-- field. Keep it in a one-to-one dependent record instead of altering sales.
CREATE TABLE IF NOT EXISTS public.instant_sale_tables (
  sale_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  table_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instant_sale_tables_sale_workspace_fk
    FOREIGN KEY (sale_id, workspace_id)
    REFERENCES public.sales (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT instant_sale_tables_number_check
    CHECK (table_number ~ '^[1-9][0-9]{0,3}$')
);

CREATE INDEX IF NOT EXISTS idx_instant_sale_tables_workspace_sale
  ON public.instant_sale_tables (workspace_id, sale_id);

ALTER TABLE public.instant_sale_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instant_sale_tables_select ON public.instant_sale_tables;
CREATE POLICY instant_sale_tables_select
  ON public.instant_sale_tables
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR EXISTS (
        SELECT 1
        FROM public.sales
        WHERE sales.id = instant_sale_tables.sale_id
          AND sales.workspace_id = instant_sale_tables.workspace_id
          AND sales.cashier_id = (SELECT auth.uid())
      )
    )
  );

REVOKE ALL ON public.instant_sale_tables FROM anon, authenticated;
GRANT SELECT ON public.instant_sale_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instant_sale_tables TO service_role;

-- Store the assignment in the same transaction as checkout. The existing
-- checkout function is intentionally adapted from the deployed definition so
-- its validation and inventory logic remain unchanged.
DO $$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.complete_sale(jsonb)'::regprocedure)
  INTO v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    'RETURNING id, sequence_id INTO new_sale_id, v_sequence_id;[[:space:]]+FOR snapshot',
    $replacement$
    RETURNING id, sequence_id INTO new_sale_id, v_sequence_id;

    IF COALESCE(payload->>'origin', 'pos') = 'instant_pos'
       AND NULLIF(payload->>'instant_table_number', '') IS NOT NULL THEN
        INSERT INTO public.instant_sale_tables (
            sale_id,
            workspace_id,
            table_number
        )
        VALUES (
            new_sale_id,
            p_workspace_id,
            NULLIF(payload->>'instant_table_number', '')
        );
    END IF;

    FOR snapshot$replacement$
  );

  IF v_updated_definition = v_definition
    OR position('instant_sale_tables' IN v_updated_definition) = 0 THEN
    RAISE EXCEPTION 'Could not update complete_sale to store Instant POS table assignments';
  END IF;

  EXECUTE v_updated_definition;
END;
$$;
