-- Tables in public schema

CREATE TABLE public.app_permissions (
    key_name text PRIMARY KEY,
    key_value text NOT NULL
);

CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    code text UNIQUE DEFAULT public.generate_unique_workspace_code(),
    created_at timestamp with time zone DEFAULT now(),
    allow_pos boolean NOT NULL DEFAULT false,
    allow_customers boolean NOT NULL DEFAULT false,
    allow_orders boolean NOT NULL DEFAULT false,
    allow_invoices boolean NOT NULL DEFAULT false,
    is_configured boolean NOT NULL DEFAULT false,
    deleted_at timestamp with time zone,
    default_currency text NOT NULL DEFAULT 'usd'::text,
    iqd_display_preference text NOT NULL DEFAULT 'IQD'::text,
    eur_conversion_enabled boolean DEFAULT false,
    try_conversion_enabled boolean DEFAULT false,
    locked_workspace boolean DEFAULT false
);

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name text,
    role text,
    workspace_id uuid REFERENCES public.workspaces(id)
);

CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    name character varying NOT NULL,
    description text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1,
    is_deleted boolean NOT NULL DEFAULT false,
    user_id uuid REFERENCES auth.users(id)
);

CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id),
    sku character varying NOT NULL,
    name character varying NOT NULL,
    description text DEFAULT ''::text,
    category character varying DEFAULT 'Other'::character varying,
    price numeric NOT NULL DEFAULT 0,
    cost_price numeric NOT NULL DEFAULT 0,
    quantity integer NOT NULL DEFAULT 0,
    min_stock_level integer NOT NULL DEFAULT 10,
    unit character varying NOT NULL DEFAULT 'pcs'::character varying,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    is_deleted boolean DEFAULT false,
    workspace_id uuid REFERENCES public.workspaces(id),
    category_id uuid REFERENCES public.categories(id)
);

CREATE TABLE public.customers (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id),
    name text NOT NULL,
    email text,
    phone text,
    address text,
    city text,
    country text,
    notes text,
    total_orders integer DEFAULT 0,
    total_spent numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    is_deleted boolean DEFAULT false,
    workspace_id uuid REFERENCES public.workspaces(id)
);

CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id),
    order_number text NOT NULL,
    customer_id uuid REFERENCES public.customers(id),
    customer_name text,
    items jsonb NOT NULL,
    subtotal numeric NOT NULL,
    tax numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    total numeric NOT NULL,
    status text DEFAULT 'pending'::text,
    notes text,
    shipping_address text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    is_deleted boolean DEFAULT false,
    workspace_id uuid REFERENCES public.workspaces(id),
    currency text DEFAULT 'usd'::text
);

CREATE TABLE public.invoices (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id),
    invoice_number text NOT NULL,
    order_id uuid REFERENCES public.orders(id),
    customer_id uuid REFERENCES public.customers(id),
    customer_name text,
    items jsonb NOT NULL,
    subtotal numeric NOT NULL,
    tax numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    total numeric NOT NULL,
    status text DEFAULT 'draft'::text,
    due_date timestamp with time zone,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    is_deleted boolean DEFAULT false,
    workspace_id uuid REFERENCES public.workspaces(id),
    currency text DEFAULT 'usd'::text
);

CREATE TABLE public.sales (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    cashier_id uuid NOT NULL REFERENCES auth.users(id),
    total_amount numeric NOT NULL,
    settlement_currency text NOT NULL,
    exchange_source text NOT NULL,
    exchange_rate numeric NOT NULL,
    exchange_rate_timestamp timestamp with time zone NOT NULL,
    exchange_rates jsonb,
    origin text NOT NULL,
    payment_method text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.sale_items (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    sale_id uuid NOT NULL REFERENCES public.sales(id),
    product_id uuid NOT NULL REFERENCES public.products(id),
    quantity integer NOT NULL,
    unit_price numeric NOT NULL,
    total_price numeric NOT NULL,
    original_currency text NOT NULL DEFAULT 'usd'::text,
    original_unit_price numeric NOT NULL,
    converted_unit_price numeric NOT NULL,
    settlement_currency text NOT NULL DEFAULT 'usd'::text,
    cost_price numeric NOT NULL DEFAULT 0,
    converted_cost_price numeric NOT NULL DEFAULT 0,
    negotiated_price numeric
);
