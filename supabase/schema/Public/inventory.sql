CREATE TABLE public.inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  storage_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT inventory_workspace_product_storage_key UNIQUE (workspace_id, product_id, storage_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace
  ON public.inventory (workspace_id);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_updated
  ON public.inventory (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_deleted
  ON public.inventory (workspace_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_storage
  ON public.inventory (workspace_id, storage_id);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_product
  ON public.inventory (workspace_id, product_id);
