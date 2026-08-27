-- A recipient payout can be funded by the courier, creating an amount the
-- workspace owes that courier, or paid by the workspace immediately. Existing
-- posts retain their historical workspace-payment treatment.
alter table delivery.delivery_shipments
  add column if not exists recipient_payout_funding text;

update delivery.delivery_shipments
set recipient_payout_funding = 'workspace_payment'
where recipient_payout_funding is null;

alter table delivery.delivery_shipments
  alter column recipient_payout_funding set default 'workspace_payment',
  alter column recipient_payout_funding set not null,
  drop constraint if exists delivery_shipments_recipient_payout_funding_check,
  add constraint delivery_shipments_recipient_payout_funding_check
    check (recipient_payout_funding in ('courier_advance', 'workspace_payment'));

alter table delivery.delivery_settlements
  drop constraint if exists delivery_settlements_type_check,
  add constraint delivery_settlements_type_check
    check (type in (
      'courier_remittance',
      'courier_fee_payout',
      'courier_reimbursement',
      'merchant_payout',
      'merchant_repayment'
    )),
  drop constraint if exists delivery_settlement_party_check,
  add constraint delivery_settlement_party_check
    check (
      (
        type in ('courier_remittance', 'courier_fee_payout', 'courier_reimbursement')
        and agent_id is not null
        and merchant_profile_id is null
      )
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
      'courier_recipient_advance',
      'courier_remittance',
      'courier_fee_payout',
      'courier_reimbursement',
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
        kind in (
          'courier_collection',
          'courier_delivery_fee',
          'courier_recipient_advance',
          'courier_remittance',
          'courier_fee_payout',
          'courier_reimbursement'
        )
        and agent_id is not null
        and merchant_profile_id is null
      )
      or (
        kind in (
          'merchant_cod_payable',
          'merchant_fee',
          'merchant_recipient_payout',
          'merchant_payout',
          'merchant_repayment'
        )
        and merchant_profile_id is not null
        and agent_id is null
      )
      or kind = 'adjustment'
    );

notify pgrst, 'reload schema';
