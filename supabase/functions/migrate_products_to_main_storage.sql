CREATE OR REPLACE FUNCTION public.migrate_products_to_main_storage(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_main_storage_id uuid;
BEGIN
    INSERT INTO public.storages (
        workspace_id,
        name,
        is_system,
        is_protected,
        created_at,
        updated_at,
        is_deleted
    )
    SELECT
        p_workspace_id,
        'Main',
        true,
        true,
        timezone('utc', now()),
        timezone('utc', now()),
        false
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.storages
        WHERE workspace_id = p_workspace_id
          AND LOWER(name) = 'main'
          AND COALESCE(is_deleted, false) = false
    );

    SELECT id
    INTO v_main_storage_id
    FROM public.storages
    WHERE workspace_id = p_workspace_id
      AND LOWER(name) = 'main'
      AND COALESCE(is_deleted, false) = false
    ORDER BY created_at NULLS LAST, id
    LIMIT 1;

    INSERT INTO public.inventory (
        id,
        workspace_id,
        product_id,
        storage_id,
        quantity,
        created_at,
        updated_at,
        version,
        is_deleted
    )
    SELECT
        gen_random_uuid(),
        p.workspace_id,
        p.id,
        COALESCE(p.storage_id, v_main_storage_id),
        COALESCE(p.quantity, 0),
        COALESCE(p.created_at, timezone('utc', now())),
        COALESCE(p.updated_at, timezone('utc', now())),
        GREATEST(COALESCE(p.version, 1), 1),
        false
    FROM public.products p
    WHERE p.workspace_id = p_workspace_id
      AND COALESCE(p.is_deleted, false) = false
      AND COALESCE(p.quantity, 0) > 0
      AND COALESCE(p.storage_id, v_main_storage_id) IS NOT NULL
    ON CONFLICT (workspace_id, product_id, storage_id) DO UPDATE
    SET
        quantity = EXCLUDED.quantity,
        updated_at = EXCLUDED.updated_at,
        version = GREATEST(public.inventory.version, EXCLUDED.version),
        is_deleted = false;

    UPDATE public.products
    SET
        storage_id = COALESCE(storage_id, v_main_storage_id),
        updated_at = timezone('utc', now())
    WHERE workspace_id = p_workspace_id
      AND COALESCE(is_deleted, false) = false
      AND COALESCE(quantity, 0) > 0
      AND storage_id IS NULL
      AND v_main_storage_id IS NOT NULL;
END;
$function$
