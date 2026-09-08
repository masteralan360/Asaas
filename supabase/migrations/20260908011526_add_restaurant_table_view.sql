-- Restaurant Table View is an opt-in workspace configuration.  Open tickets
-- are deliberately kept outside sales: no payment, stock, or ledger effect is
-- recorded until the existing complete_sale workflow runs at checkout.
CREATE TABLE IF NOT EXISTS public.restaurant_table_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  table_count integer NOT NULL DEFAULT 20,
  vip_table_numbers integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT restaurant_table_settings_table_count_check
    CHECK (table_count BETWEEN 1 AND 100),
  CONSTRAINT restaurant_table_settings_vip_numbers_check
    CHECK (COALESCE(array_position(vip_table_numbers, 0), 0) = 0)
);

CREATE TABLE IF NOT EXISTS public.restaurant_pos_tickets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  table_number integer NOT NULL,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NULL,
  kitchen_routed_at timestamptz NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT restaurant_pos_tickets_table_number_check CHECK (table_number BETWEEN 1 AND 100),
  CONSTRAINT restaurant_pos_tickets_status_check CHECK (status IN ('pending', 'preparing', 'ready', 'served')),
  CONSTRAINT restaurant_pos_tickets_items_array_check CHECK (jsonb_typeof(items) = 'array')
);

-- Exactly one open ticket may occupy a table.  This also makes a stale or
-- concurrent transfer fail safely instead of overwriting another order.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_pos_tickets_active_table_unique
  ON public.restaurant_pos_tickets (workspace_id, table_number)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS restaurant_pos_tickets_workspace_active_idx
  ON public.restaurant_pos_tickets (workspace_id, updated_at DESC)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION public.validate_restaurant_table_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF cardinality(NEW.vip_table_numbers) <> cardinality(ARRAY(
    SELECT DISTINCT table_number
    FROM unnest(NEW.vip_table_numbers) AS vip(table_number)
  )) THEN
    RAISE EXCEPTION 'VIP tables cannot contain duplicates' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.vip_table_numbers) AS vip(table_number)
    WHERE vip.table_number < 1 OR vip.table_number > NEW.table_count
  ) THEN
    RAISE EXCEPTION 'VIP tables must be within the configured table range'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      (OLD.enabled = true AND NEW.enabled = false)
      OR NEW.table_count < OLD.table_count
    )
    AND EXISTS (
      SELECT 1
      FROM public.restaurant_pos_tickets ticket
      WHERE ticket.workspace_id = NEW.workspace_id
        AND ticket.is_deleted = false
        AND (
          NEW.enabled = false
          OR ticket.table_number > NEW.table_count
        )
    ) THEN
    RAISE EXCEPTION 'Close, clear, or transfer affected restaurant tickets before changing this configuration'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.version := GREATEST(OLD.version + 1, NEW.version);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_restaurant_table_settings ON public.restaurant_table_settings;
CREATE TRIGGER validate_restaurant_table_settings
  BEFORE INSERT OR UPDATE ON public.restaurant_table_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_restaurant_table_settings();

CREATE OR REPLACE FUNCTION public.validate_restaurant_pos_ticket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  configured_table_count integer;
BEGIN
  SELECT table_count
  INTO configured_table_count
  FROM public.restaurant_table_settings
  WHERE workspace_id = NEW.workspace_id
    AND enabled = true;

  IF configured_table_count IS NULL THEN
    RAISE EXCEPTION 'Restaurant Table View is not enabled for this workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.table_number > configured_table_count THEN
    RAISE EXCEPTION 'The selected table is outside the configured table range'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.version := GREATEST(OLD.version + 1, NEW.version);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_restaurant_pos_ticket ON public.restaurant_pos_tickets;
CREATE TRIGGER validate_restaurant_pos_ticket
  BEFORE INSERT OR UPDATE ON public.restaurant_pos_tickets
  FOR EACH ROW EXECUTE FUNCTION public.validate_restaurant_pos_ticket();

-- This update is protected by the partial unique index above.  The function
-- intentionally runs as INVOKER so ordinary RLS policies still govern access.
CREATE OR REPLACE FUNCTION public.move_restaurant_pos_ticket(
  p_ticket_id uuid,
  p_destination_table_number integer
)
RETURNS public.restaurant_pos_tickets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  moved_ticket public.restaurant_pos_tickets;
BEGIN
  IF p_destination_table_number NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'The destination table is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.restaurant_pos_tickets AS ticket
  SET table_number = p_destination_table_number
  WHERE ticket.id = p_ticket_id
    AND ticket.workspace_id = public.current_workspace_id()
    AND ticket.is_deleted = false
  RETURNING ticket.* INTO moved_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active restaurant ticket was not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN moved_ticket;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'The destination table is already occupied' USING ERRCODE = '23505';
END;
$function$;

ALTER TABLE public.restaurant_table_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_pos_tickets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_table_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_pos_tickets TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_restaurant_pos_ticket(uuid, integer) TO authenticated;

CREATE POLICY restaurant_table_settings_select
  ON public.restaurant_table_settings
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());
CREATE POLICY restaurant_table_settings_admin_insert
  ON public.restaurant_table_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );
CREATE POLICY restaurant_table_settings_admin_update
  ON public.restaurant_table_settings
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );
CREATE POLICY restaurant_table_settings_admin_delete
  ON public.restaurant_table_settings
  FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY restaurant_pos_tickets_select
  ON public.restaurant_pos_tickets
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());
CREATE POLICY restaurant_pos_tickets_insert
  ON public.restaurant_pos_tickets
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());
CREATE POLICY restaurant_pos_tickets_update
  ON public.restaurant_pos_tickets
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());
CREATE POLICY restaurant_pos_tickets_delete
  ON public.restaurant_pos_tickets
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DO $do$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_table_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$do$;

DO $do$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_pos_tickets;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$do$;

NOTIFY pgrst, 'reload schema';
