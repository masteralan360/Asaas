CREATE TABLE public.installment_sale_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installment_sale_id uuid NOT NULL,
  installment_id uuid NULL,
  amount numeric NOT NULL,
  payment_method text NOT NULL,
  paid_at timestamp with time zone NOT NULL,
  note text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);
