-- Indexes in public schema

-- Products
CREATE INDEX idx_products_user_id ON public.products USING btree (user_id);
CREATE INDEX idx_products_updated_at ON public.products USING btree (updated_at);
CREATE INDEX idx_products_sku ON public.products USING btree (sku);
CREATE INDEX idx_products_category ON public.products USING btree (category);
CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);

-- Customers
CREATE INDEX idx_customers_user_id ON public.customers USING btree (user_id);
CREATE INDEX idx_customers_updated_at ON public.customers USING btree (updated_at);
CREATE INDEX idx_customers_email ON public.customers USING btree (email);

-- Categories
CREATE UNIQUE INDEX idx_categories_unique_name_workspace ON public.categories USING btree (workspace_id, lower((name)::text)) WHERE (is_deleted IS FALSE);
CREATE INDEX idx_categories_workspace_id ON public.categories USING btree (workspace_id);
CREATE INDEX idx_categories_user_id ON public.categories USING btree (user_id);

-- Workspaces
CREATE INDEX idx_workspaces_deleted_at ON public.workspaces USING btree (deleted_at);
