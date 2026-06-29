CREATE OR REPLACE FUNCTION public.lock_workspace_when_transfer_limit_reached(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_data_transfer_bytes bigint;
  v_transfer_limit bigint;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  INTO
    v_data_transfer_bytes,
    v_transfer_limit
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = p_workspace_id;

  IF v_transfer_limit IS NOT NULL
    AND COALESCE(v_data_transfer_bytes, 0) >= v_transfer_limit THEN
    UPDATE public.workspaces
    SET locked_workspace = true
    WHERE id = p_workspace_id
      AND COALESCE(locked_workspace, false) = false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_transfer_limit_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.lock_workspace_when_transfer_limit_reached(NEW.workspace_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_transfer_limit_lock_on_usage
  ON public.workspace_usage;

CREATE TRIGGER enforce_workspace_transfer_limit_lock_on_usage
AFTER INSERT OR UPDATE OF data_transfer_bytes ON public.workspace_usage
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_transfer_limit_lock();

DROP TRIGGER IF EXISTS enforce_workspace_transfer_limit_lock_on_limits
  ON public.workspace_usage_limits;

CREATE TRIGGER enforce_workspace_transfer_limit_lock_on_limits
AFTER INSERT OR UPDATE OF monthly_data_transfer_limit_bytes ON public.workspace_usage_limits
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_transfer_limit_lock();

CREATE OR REPLACE FUNCTION public.apply_workspace_data_transfer_usage(
  p_workspace_id uuid,
  p_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current bigint;
  v_next bigint;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF COALESCE(p_bytes, 0) < 0 THEN
    RAISE EXCEPTION 'Data transfer bytes must be zero or greater';
  END IF;

  PERFORM public.ensure_workspace_usage_row(p_workspace_id);

  SELECT usage.data_transfer_bytes
  INTO v_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next := COALESCE(v_current, 0) + COALESCE(p_bytes, 0);

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = v_next,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = p_workspace_id;
END;
$function$;

SELECT public.lock_workspace_when_transfer_limit_reached(usage.workspace_id)
FROM public.workspace_usage AS usage
INNER JOIN public.workspace_usage_limits AS limits
  ON limits.workspace_id = usage.workspace_id
WHERE limits.monthly_data_transfer_limit_bytes IS NOT NULL
  AND usage.data_transfer_bytes >= limits.monthly_data_transfer_limit_bytes;

REVOKE ALL ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_workspace_transfer_limit_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) TO service_role;
