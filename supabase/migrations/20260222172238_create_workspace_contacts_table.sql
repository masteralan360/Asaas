-- Drop the old table if it exists
DROP TABLE IF EXISTS public.workspace_phones;
DROP TABLE IF EXISTS public.workspace_contacts;

-- Create the new table
CREATE TABLE public.workspace_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('phone', 'email', 'address')),
    value TEXT NOT NULL,
    label TEXT,
    is_primary BOOLEAN DEFAULT false,
    sync_status TEXT DEFAULT 'synced',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policies
ALTER TABLE public.workspace_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspace contacts"
    ON public.workspace_contacts FOR SELECT
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can insert workspace contacts"
    ON public.workspace_contacts FOR INSERT
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can update workspace contacts"
    ON public.workspace_contacts FOR UPDATE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id)
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can delete workspace contacts"
    ON public.workspace_contacts FOR DELETE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);
