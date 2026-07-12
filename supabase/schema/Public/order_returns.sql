CREATE TABLE public.order_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  refund_amount numeric NOT NULL DEFAULT 0,
  returned_by uuid NULL,
  returned_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT order_returns_status_check CHECK (status IN ('posted', 'voided')),
  CONSTRAINT order_returns_refund_amount_check CHECK (refund_amount >= 0),
  PRIMARY KEY (id)
);
