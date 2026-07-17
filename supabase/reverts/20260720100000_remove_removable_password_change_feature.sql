-- BEGIN REMOVABLE PASSWORD CHANGE FEATURE REVERT
-- Run manually only after the feature code has been removed from Settings.tsx.

DROP FUNCTION IF EXISTS public.store_current_user_password_backup(text);
DROP TABLE IF EXISTS notifications.passwords;

NOTIFY pgrst, 'reload schema';

-- END REMOVABLE PASSWORD CHANGE FEATURE REVERT
