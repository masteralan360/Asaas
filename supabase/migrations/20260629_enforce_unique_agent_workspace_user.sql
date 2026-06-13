WITH ranked_agent_links AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, linked_user_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS link_rank
  FROM crm.agents
  WHERE linked_user_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false
)
UPDATE crm.agents AS agent
SET
  linked_user_id = NULL,
  updated_at = now(),
  version = COALESCE(agent.version, 1) + 1
FROM ranked_agent_links AS ranked
WHERE agent.id = ranked.id
  AND ranked.link_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_agents_workspace_linked_user
  ON crm.agents (workspace_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL
    AND COALESCE(is_deleted, false) = false;

CREATE OR REPLACE FUNCTION public.enforce_crm_agent_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.business_partners bp
    WHERE bp.id = NEW.business_partner_id
      AND bp.workspace_id = NEW.workspace_id
      AND COALESCE(bp.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Agent business partner must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.linked_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.linked_user_id
      AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Linked workspace user must belong to the agent workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.linked_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM crm.agents a
    WHERE a.workspace_id = NEW.workspace_id
      AND a.linked_user_id = NEW.linked_user_id
      AND a.id <> NEW.id
      AND COALESCE(a.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Workspace user is already linked to another agent'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
