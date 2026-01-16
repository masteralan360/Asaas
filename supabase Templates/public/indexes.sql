-- Indexes in public schema

-- Products
CREATE INDEX idx_products_user_id ON public.products USING btree (user_id);
CREATE INDEX idx_products_updated_at ON public.products USING btree (updated_at);
CREATE INDEX idx_products_sku ON public.products USING btree (sku);
CREATE INDEX idx_products_category ON public.products USING btree (category);
CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);

CREATE INDEX idx_products_barcode ON public.products USING btree (barcode);
CREATE INDEX idx_products_can_be_returned ON public.products USING btree (can_be_returned);

-- Customers
CREATE INDEX idx_customers_user_id ON public.customers USING btree (user_id);
CREATE INDEX idx_customers_updated_at ON public.customers USING btree (updated_at);
CREATE INDEX idx_customers_email ON public.customers USING btree (email);

-- Sales
CREATE INDEX idx_sales_workspace_id ON public.sales USING btree (workspace_id);
CREATE INDEX idx_sales_cashier_id ON public.sales USING btree (cashier_id);
CREATE INDEX idx_sales_created_at ON public.sales USING btree (created_at);
CREATE INDEX idx_sales_is_returned ON public.sales USING btree (is_returned);
CREATE INDEX idx_sales_payment_method ON public.sales USING btree (payment_method);

-- Sale Items
CREATE INDEX idx_sale_items_sale_id ON public.sale_items USING btree (sale_id);
CREATE INDEX idx_sale_items_product_id ON public.sale_items USING btree (product_id);
CREATE INDEX idx_sale_items_is_returned ON public.sale_items USING btree (is_returned);
CREATE INDEX idx_sale_items_returned_quantity ON public.sale_items USING btree (returned_quantity);

-- Categories
CREATE UNIQUE INDEX idx_categories_unique_name_workspace ON public.categories USING btree (workspace_id, lower((name)::text)) WHERE (is_deleted IS FALSE);
CREATE INDEX idx_categories_workspace_id ON public.categories USING btree (workspace_id);
CREATE INDEX idx_categories_user_id ON public.categories USING btree (user_id);

-- Workspaces
CREATE INDEX idx_workspaces_deleted_at ON public.workspaces USING btree (deleted_at);
