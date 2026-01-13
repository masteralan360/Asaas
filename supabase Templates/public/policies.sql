-- RLS Policies for public schema

-- Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own products" ON public.products FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own products" ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own products" ON public.products FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own products" ON public.products FOR DELETE USING (auth.uid() = user_id);

-- Customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own customers" ON public.customers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own customers" ON public.customers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own customers" ON public.customers FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own customers" ON public.customers FOR DELETE USING (auth.uid() = user_id);

-- Orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own orders" ON public.orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own orders" ON public.orders FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own orders" ON public.orders FOR DELETE USING (auth.uid() = user_id);

-- Invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own invoices" ON public.invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own invoices" ON public.invoices FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own invoices" ON public.invoices FOR DELETE USING (auth.uid() = user_id);

-- Sales
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sales viewable by workspace members" ON public.sales FOR SELECT USING (workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Sales insertable by workspace members" ON public.sales FOR INSERT WITH CHECK (workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Sales modifiable by workspace admins" ON public.sales FOR ALL USING (workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Sale Items
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sale Items accessible by workspace members" ON public.sale_items FOR SELECT USING (sale_id IN (SELECT sales.id FROM sales WHERE sales.workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid())));

-- Categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories viewable by workspace members" ON public.categories FOR SELECT USING (workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Categories manageable by admins and staff" ON public.categories FOR ALL USING (workspace_id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'staff')));

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Workspaces
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspaces are viewable by members" ON public.workspaces FOR SELECT USING (id IN (SELECT profiles.workspace_id FROM profiles WHERE profiles.id = auth.uid()));

-- App Permissions
ALTER TABLE public.app_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only admins can read app permissions" ON public.app_permissions FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
