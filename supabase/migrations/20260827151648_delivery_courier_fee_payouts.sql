-- A courier can retain their fee from COD cash. When no sufficient cash was
-- collected, this settlement records the remaining fee as a real payout from
-- the workspace instead of leaving an invisible negative courier balance.
alter table delivery.delivery_settlements
  drop constraint if exists delivery_settlements_type_check,
  add constraint delivery_settlements_type_check
    check (type in ('courier_remittance', 'courier_fee_payout', 'merchant_payout', 'merchant_repayment')),
  drop constraint if exists delivery_settlement_party_check,
  add constraint delivery_settlement_party_check
    check (
      (type in ('courier_remittance', 'courier_fee_payout') and agent_id is not null and merchant_profile_id is null)
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
      'courier_fee_payout',
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
        kind in ('courier_collection', 'courier_remittance', 'courier_delivery_fee', 'courier_fee_payout')
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
