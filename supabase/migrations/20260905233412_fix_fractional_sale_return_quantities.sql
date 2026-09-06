-- The services migration redefined process_sale_return after fractional
-- inventory quantities were introduced, restoring integer variables and casts.
-- Restore numeric handling for all return quantities, including service lines.
DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.process_sale_return(uuid, uuid, jsonb, text, text)'::regprocedure)
    INTO function_sql;

  IF position('v_requested_quantity integer;' IN function_sql) = 0
     OR position('v_return_quantity integer;' IN function_sql) = 0
     OR position('(v_item_payload->>''quantity'')::integer' IN function_sql) = 0 THEN
    RAISE EXCEPTION
      'process_sale_return does not contain the expected integer quantity implementation';
  END IF;

  function_sql := replace(function_sql, 'v_requested_quantity integer;', 'v_requested_quantity numeric;');
  function_sql := replace(function_sql, 'v_return_quantity integer;', 'v_return_quantity numeric;');
  function_sql := replace(function_sql, 'v_remaining_to_restore integer := 0;', 'v_remaining_to_restore numeric := 0;');
  function_sql := replace(function_sql, 'v_batch_quantity integer := 0;', 'v_batch_quantity numeric := 0;');
  function_sql := replace(function_sql, 'v_restore_quantity integer := 0;', 'v_restore_quantity numeric := 0;');
  function_sql := replace(function_sql, 'v_leftover_batch_quantity integer := 0;', 'v_leftover_batch_quantity numeric := 0;');
  function_sql := replace(function_sql, '(v_item_payload->>''quantity'')::integer', '(v_item_payload->>''quantity'')::numeric');
  function_sql := replace(function_sql, '(v_batch_allocation->>''quantity'')::integer', '(v_batch_allocation->>''quantity'')::numeric');

  EXECUTE function_sql;
END $$;
