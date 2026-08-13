-- Jumla Khaleej is the only website storefront that intentionally sells from
-- more than the workspace's single Marketplace storage.  The ordered array is
-- also the fulfillment priority used by its bound storefront order endpoint.
ALTER TABLE public.website_storefront_configs
    ADD COLUMN IF NOT EXISTS featured_storage_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

UPDATE public.website_storefront_configs
SET featured_storage_ids = ARRAY[
    'f89559ce-1156-4683-9ad0-8d026c2f6f97'::uuid, -- maxzan 1 (fulfill first)
    '5736da56-ba85-47a1-a930-215584ea273d'::uuid  -- maxzan 2
]
WHERE site_key = 'jumla-khaleej'
  AND workspace_id = 'ec5305ba-e804-4e3e-a600-6d9692108b86';
