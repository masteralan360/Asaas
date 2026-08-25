-- Agent deletion is a soft delete. The linked business partner can be
-- retired in the same sync batch, so relationship validation only applies
-- while the agent remains active.
CREATE OR REPLACE FUNCTION public.enforce_crm_agent_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
BEGIN
  IF COALESCE(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;

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
