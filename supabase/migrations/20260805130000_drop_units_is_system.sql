-- Built-in units are hardcoded in the app (DEFAULT_UNITS) and are no longer
-- stored in the units table, so the is_system flag is always false and the
-- column is dead weight. Drop it. The app data layer (models.ts / hooks.ts)
-- already removed all isSystem references in the same release.
ALTER TABLE public.units DROP COLUMN IF EXISTS is_system;
