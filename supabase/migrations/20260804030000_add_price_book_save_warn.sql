-- Price Books gain a per-workspace "warn on save" flag. When any Price Book
-- in the workspace has save_warn enabled, saving a product or business
-- partner without a Price Book selection first shows a confirmation warning.
-- Defaults to true so existing workspaces keep the current behavior until
-- the workspace owner opts out per Price Book.

BEGIN;

ALTER TABLE public.price_books
  ADD COLUMN IF NOT EXISTS save_warn boolean NOT NULL DEFAULT true;

COMMIT;
