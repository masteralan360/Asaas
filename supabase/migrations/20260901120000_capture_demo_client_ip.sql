-- Capture the originating client address whenever a demo timer is registered.
-- The value comes from Supabase/PostgREST's request context, rather than from
-- a client-provided RPC argument, so callers cannot choose the stored address.

ALTER TABLE public.demos
  ADD COLUMN IF NOT EXISTS client_ip inet;

COMMENT ON COLUMN public.demos.client_ip IS
  'Client IP address captured from the demo registration request.';

CREATE OR REPLACE FUNCTION public.insert_demo(
    p_workspace_id uuid,
    p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_headers jsonb := COALESCE(
        NULLIF(current_setting('request.headers', true), ''),
        '{}'
    )::jsonb;
    v_raw_client_ip text;
    v_client_ip inet;
BEGIN
    -- X-Forwarded-For can contain a proxy chain; the first value is the
    -- originating client. Fall back to common single-address proxy headers.
    v_raw_client_ip := NULLIF(
        btrim(
            split_part(
                COALESCE(
                    v_headers ->> 'x-forwarded-for',
                    v_headers ->> 'cf-connecting-ip',
                    v_headers ->> 'x-real-ip'
                ),
                ',',
                1
            )
        ),
        ''
    );

    IF v_raw_client_ip IS NOT NULL THEN
        BEGIN
            v_client_ip := v_raw_client_ip::inet;
        EXCEPTION
            WHEN invalid_text_representation THEN
                -- Do not prevent demo creation when a proxy sends a malformed
                -- address. The timer remains usable and the IP stays NULL.
                v_client_ip := NULL;
        END;
    END IF;

    INSERT INTO public.demos (workspace_id, expires_at, client_ip)
    VALUES (p_workspace_id, p_expires_at, v_client_ip)
    ON CONFLICT (workspace_id)
    DO UPDATE SET
        expires_at = EXCLUDED.expires_at,
        client_ip = COALESCE(EXCLUDED.client_ip, public.demos.client_ip);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_demo(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_demo(uuid, timestamptz) TO anon;
