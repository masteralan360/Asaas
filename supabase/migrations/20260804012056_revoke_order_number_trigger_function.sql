-- Trigger functions are internal implementation details and must not be
-- exposed as callable SECURITY DEFINER RPCs.
REVOKE ALL ON FUNCTION crm.assign_order_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.assign_order_number() FROM anon, authenticated;
