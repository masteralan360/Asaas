-- Row Level Security (RLS) Policies for Asaas
-- Run this after schema.sql in your Supabase SQL Editor

-- Enable RLS on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Products Policies
CREATE POLICY "Users can view workspace products"
    ON products FOR SELECT
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can insert workspace products"
    ON products FOR INSERT
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can update workspace products"
    ON products FOR UPDATE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id)
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can delete workspace products"
    ON products FOR DELETE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

-- Customers Policies
CREATE POLICY "Users can view workspace customers"
    ON customers FOR SELECT
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can insert workspace customers"
    ON customers FOR INSERT
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can update workspace customers"
    ON customers FOR UPDATE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id)
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can delete workspace customers"
    ON customers FOR DELETE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

-- Orders Policies
CREATE POLICY "Users can view workspace orders"
    ON orders FOR SELECT
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can insert workspace orders"
    ON orders FOR INSERT
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can update workspace orders"
    ON orders FOR UPDATE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id)
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can delete workspace orders"
    ON orders FOR DELETE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

-- Invoices Policies
CREATE POLICY "Users can view workspace invoices"
    ON invoices FOR SELECT
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can insert workspace invoices"
    ON invoices FOR INSERT
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can update workspace invoices"
    ON invoices FOR UPDATE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id)
    WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

CREATE POLICY "Users can delete workspace invoices"
    ON invoices FOR DELETE
    USING ((auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid = workspace_id);

-- Note: For multi-tenant / organization-based access,
-- you would add an organization_id column and modify policies accordingly:
--
-- Example:
-- CREATE POLICY "Organization members can view products"
--     ON products FOR SELECT
--     USING (
--         organization_id IN (
--             SELECT organization_id FROM organization_members
--             WHERE user_id = auth.uid()
--         )
--     );
