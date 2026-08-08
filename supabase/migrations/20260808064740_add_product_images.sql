-- Additional product images deliberately live separately from products.image_url.
-- The primary image remains in products.image_url and is always position 0 in the UI.
ALTER TABLE public.products
  ADD CONSTRAINT products_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  image_url text NOT NULL,
  position smallint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_images_product_workspace_fkey
    FOREIGN KEY (product_id, workspace_id)
    REFERENCES public.products (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT product_images_image_url_not_blank
    CHECK (char_length(trim(image_url)) > 0),
  CONSTRAINT product_images_position_range
    CHECK (position BETWEEN 1 AND 9),
  CONSTRAINT product_images_product_position_unique
    UNIQUE (product_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX product_images_workspace_product_position_idx
  ON public.product_images (workspace_id, product_id, position);

CREATE TRIGGER update_product_images_updated_at
BEFORE UPDATE ON public.product_images
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_images_select
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

CREATE POLICY product_images_insert
  ON public.product_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

CREATE POLICY product_images_update
  ON public.product_images
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

CREATE POLICY product_images_delete
  ON public.product_images
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;

-- Replaces the additional-image collection in a single transaction. The client
-- passes the final ordered list; omitted existing images are hard-deleted.
CREATE OR REPLACE FUNCTION public.replace_product_images(
  p_workspace_id uuid,
  p_product_id uuid,
  p_images jsonb
)
RETURNS SETOF public.product_images
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_image jsonb;
  v_image_id uuid;
  v_image_url text;
  v_position smallint := 0;
  v_existing_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_workspace_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'workspace and product are required';
  END IF;

  IF p_workspace_id <> public.current_workspace_id()
    OR public.current_user_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'not allowed to manage product images';
  END IF;

  IF jsonb_typeof(p_images) <> 'array' OR jsonb_array_length(p_images) > 9 THEN
    RAISE EXCEPTION 'a product can have at most 9 additional images';
  END IF;

  PERFORM 1
  FROM public.products
  WHERE id = p_product_id
    AND workspace_id = p_workspace_id
    AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found in workspace';
  END IF;

  FOR v_image IN SELECT value FROM jsonb_array_elements(p_images)
  LOOP
    v_position := v_position + 1;
    v_image_url := trim(COALESCE(v_image ->> 'image_url', ''));

    IF v_image_url = '' THEN
      RAISE EXCEPTION 'image_url is required';
    END IF;

    v_image_id := NULLIF(v_image ->> 'id', '')::uuid;
    IF v_image_id IS NOT NULL THEN
      IF v_image_id = ANY(v_existing_ids) THEN
        RAISE EXCEPTION 'duplicate product image id';
      END IF;

      PERFORM 1
      FROM public.product_images
      WHERE id = v_image_id
        AND workspace_id = p_workspace_id
        AND product_id = p_product_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'product image does not belong to this product';
      END IF;

      v_existing_ids := array_append(v_existing_ids, v_image_id);
    END IF;
  END LOOP;

  DELETE FROM public.product_images
  WHERE workspace_id = p_workspace_id
    AND product_id = p_product_id
    AND NOT (id = ANY(v_existing_ids));

  v_position := 0;
  FOR v_image IN SELECT value FROM jsonb_array_elements(p_images)
  LOOP
    v_position := v_position + 1;
    v_image_id := NULLIF(v_image ->> 'id', '')::uuid;
    v_image_url := trim(v_image ->> 'image_url');

    IF v_image_id IS NULL THEN
      INSERT INTO public.product_images (workspace_id, product_id, image_url, position)
      VALUES (p_workspace_id, p_product_id, v_image_url, v_position);
    ELSE
      UPDATE public.product_images
      SET image_url = v_image_url,
          position = v_position
      WHERE id = v_image_id;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT *
  FROM public.product_images
  WHERE workspace_id = p_workspace_id
    AND product_id = p_product_id
  ORDER BY position;
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_product_images(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_product_images(uuid, uuid, jsonb) TO authenticated;
