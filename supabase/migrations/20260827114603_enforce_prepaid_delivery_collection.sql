-- A prepaid recipient must not increase courier cash custody. The delivery
-- fee and recipient payout remain independent merchant-account movements.
alter table delivery.delivery_shipments
  drop constraint if exists delivery_shipments_prepaid_collection_check,
  add constraint delivery_shipments_prepaid_collection_check
    check (
      customer_payment_status <> 'prepaid_electronically'
      or cod_amount = 0
    );
