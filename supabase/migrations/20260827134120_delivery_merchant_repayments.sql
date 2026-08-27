-- A merchant repayment is real cash received by the workspace when delivery
-- charges and recipient payouts leave that merchant with a negative delivery
-- account balance.  It belongs to the same existing settlement and ledger
-- tables so it stays visible in every delivery/accounting surface.
alter table delivery.delivery_settlements
  drop constraint if exists delivery_settlements_type_check,
  add constraint delivery_settlements_type_check
    check (type in ('courier_remittance', 'merchant_payout', 'merchant_repayment')),
  drop constraint if exists delivery_settlement_party_check,
  add constraint delivery_settlement_party_check
    check (
      (type = 'courier_remittance' and agent_id is not null and merchant_profile_id is null)
      or (
        type in ('merchant_payout', 'merchant_repayment')
        and agent_id is null
        and merchant_profile_id is not null
        and business_partner_id is not null
      )
    );

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
      'merchant_repayment',
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
        kind in ('merchant_cod_payable', 'merchant_fee', 'merchant_recipient_payout', 'merchant_payout', 'merchant_repayment')
        and merchant_profile_id is not null
        and agent_id is null
      )
      or kind = 'adjustment'
    );

notify pgrst, 'reload schema';
