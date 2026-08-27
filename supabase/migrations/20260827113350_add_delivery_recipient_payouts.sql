-- A delivery can be prepaid by the customer and/or require the courier to
-- make a company-funded payment to the recipient. Keep those facts on the
-- shipment and record the actual payment through public.payment_transactions.
alter table delivery.delivery_shipments
  add column if not exists customer_payment_status text not null default 'cash_on_delivery',
  add column if not exists recipient_payout_amount numeric not null default 0,
  add column if not exists recipient_payout_payment_transaction_id uuid null;

alter table delivery.delivery_shipments
  drop constraint if exists delivery_shipments_customer_payment_status_check,
  add constraint delivery_shipments_customer_payment_status_check
    check (customer_payment_status in ('cash_on_delivery', 'prepaid_electronically')),
  drop constraint if exists delivery_shipments_recipient_payout_amount_check,
  add constraint delivery_shipments_recipient_payout_amount_check
    check (recipient_payout_amount >= 0),
  drop constraint if exists delivery_shipments_recipient_payout_payment_transaction_id_fkey,
  add constraint delivery_shipments_recipient_payout_payment_transaction_id_fkey
    foreign key (recipient_payout_payment_transaction_id)
    references public.payment_transactions(id)
    on delete set null;

alter table delivery.delivery_ledger_entries
  drop constraint if exists delivery_ledger_entries_kind_check,
  add constraint delivery_ledger_entries_kind_check
    check (kind in (
      'courier_collection',
      'courier_delivery_fee',
      'courier_remittance',
      'merchant_cod_payable',
      'merchant_fee',
      'merchant_recipient_payout',
      'merchant_payout',
      'adjustment'
    )),
  drop constraint if exists delivery_ledger_party_check,
  add constraint delivery_ledger_party_check
    check (
      (
        kind in ('courier_collection', 'courier_remittance', 'courier_delivery_fee')
        and agent_id is not null
        and merchant_profile_id is null
      )
      or (
        kind in ('merchant_cod_payable', 'merchant_fee', 'merchant_recipient_payout', 'merchant_payout')
        and merchant_profile_id is not null
        and agent_id is null
      )
      or kind = 'adjustment'
    );

notify pgrst, 'reload schema';
