-- Server-side demo expiry tracking table.
-- This table stores demo workspace expiry timestamps so the server
-- can enforce time limits independently of the client clock.
-- All access is via SECURITY DEFINER RPCs granted to anon.

CREATE TABLE IF NOT EXISTS public.demos (
    workspace_id uuid PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demos ENABLE ROW LEVEL SECURITY;

-- Insert or upsert a demo timer record.
-- Called by the client after creating a demo workspace locally.
CREATE OR REPLACE FUNCTION public.insert_demo(
    p_workspace_id uuid,
    p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.demos (workspace_id, expires_at)
    VALUES (p_workspace_id, p_expires_at)
    ON CONFLICT (workspace_id)
    DO UPDATE SET expires_at = EXCLUDED.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_demo(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_demo(uuid, timestamptz) TO anon;

-- Remove a demo timer record.
-- Called by the client on demo cleanup (sign-out or explicit delete).
CREATE OR REPLACE FUNCTION public.delete_demo(
    p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.demos WHERE workspace_id = p_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_demo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_demo(uuid) TO anon;

-- Check if a demo has expired on the server side.
-- Returns { exists, expired, expires_at }.
-- When the record does not exist (e.g. server missed the insert),
-- returns expired=false so the client can still rely on its local timer.
CREATE OR REPLACE FUNCTION public.check_demo_expired(
    p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_demo public.demos%ROWTYPE;
BEGIN
    SELECT * INTO v_demo
    FROM public.demos
    WHERE workspace_id = p_workspace_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('exists', false, 'expired', false, 'expires_at', null);
    END IF;

    RETURN jsonb_build_object(
        'exists', true,
        'expired', v_demo.expires_at < now(),
        'expires_at', v_demo.expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_demo_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_demo_expired(uuid) TO anon;
