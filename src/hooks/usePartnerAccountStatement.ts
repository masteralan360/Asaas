import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import {
  db,
  useAgent,
  useAgentCommissionEntries,
  useAgentProductCommissionEntries,
  useBusinessPartner,
  useDeliveryLedgerEntries,
  useDeliveryMerchantProfiles,
  useDeliverySettlements,
  useDeliveryShipments,
  useLoans,
  useInstallmentSales,
  usePaymentTransactions,
  usePurchaseOrders,
  useSalesOrderReturnItemsForWorkspace,
  useSalesOrderReturnsForWorkspace,
  useSalesOrders
} from '@/local-db'
import { isDirectTransactionPartnerAccountEffect } from '@/local-db/payments'
import {
  getPartnerAccountStatementClosingBalances,
  type PartnerAccountStatementClosingBalance,
  type PartnerAccountStatementData
} from '@/lib/partnerAccountStatement'

const EMPTY_LOAN_PAYMENTS: NonNullable<PartnerAccountStatementData['loanPayments']> = []
const ALL_TIME_PERIOD: PartnerAccountStatementData['period'] = {
  type: 'allTime'
}

/**
 * Loads the source documents for one business partner's derived subledger.
 * Order and loan hooks intentionally use the application's existing view-own
 * filtering; this page must not bypass the visibility rules of its sources.
 */
export function usePartnerAccountStatement(
  workspaceId: string | undefined,
  partnerId: string | null | undefined,
  period: PartnerAccountStatementData['period']
) {
  const rawPartner = useBusinessPartner(partnerId || undefined)
  const agent = useAgent(rawPartner?.agentFacetId)
  const commissionEntries = useAgentCommissionEntries(workspaceId)
  const productCommissionEntries = useAgentProductCommissionEntries(workspaceId)
  const salesOrders = useSalesOrders(workspaceId)
  const salesOrderReturns = useSalesOrderReturnsForWorkspace(workspaceId)
  const salesOrderReturnItems = useSalesOrderReturnItemsForWorkspace(workspaceId)
  const purchaseOrders = usePurchaseOrders(workspaceId)
  const loans = useLoans(workspaceId)
  const installmentSales = useInstallmentSales(workspaceId)
  const paymentTransactions = usePaymentTransactions(workspaceId)
  const deliveryMerchantProfiles = useDeliveryMerchantProfiles(workspaceId)
  const deliveryLedgerEntries = useDeliveryLedgerEntries(workspaceId)
  const deliveryShipments = useDeliveryShipments(workspaceId)
  const deliverySettlements = useDeliverySettlements(workspaceId)

  const partner = rawPartner && rawPartner.workspaceId === workspaceId && !rawPartner.isDeleted ? rawPartner : undefined
  const salesAccountAgent = agent && agent.workspaceId === workspaceId && agent.salesAccountEnabled ? agent : undefined
  const partnerSalesOrders = useMemo(
    () =>
      partnerId
        ? salesOrders.filter((order) => order.businessPartnerId === partnerId || order.customerId === partnerId)
        : [],
    [partnerId, salesOrders]
  )
  const partnerPurchaseOrders = useMemo(
    () =>
      partnerId
        ? purchaseOrders.filter((order) => order.businessPartnerId === partnerId || order.supplierId === partnerId)
        : [],
    [partnerId, purchaseOrders]
  )
  const partnerSalesOrderReturns = useMemo(() => {
    const orderIds = new Set(partnerSalesOrders.map((order) => order.id))
    return salesOrderReturns.filter((orderReturn) => orderIds.has(orderReturn.orderId))
  }, [partnerSalesOrders, salesOrderReturns])
  const partnerSalesOrderReturnItems = useMemo(() => {
    const returnIds = new Set(partnerSalesOrderReturns.map((orderReturn) => orderReturn.id))
    return salesOrderReturnItems.filter((item) => returnIds.has(item.returnId))
  }, [partnerSalesOrderReturns, salesOrderReturnItems])
  const partnerLoans = useMemo(
    () =>
      partnerId
        ? loans.filter((loan) => loan.linkedPartyType === 'business_partner' && loan.linkedPartyId === partnerId)
        : [],
    [loans, partnerId]
  )
  const partnerLoanIds = useMemo(() => partnerLoans.map((loan) => loan.id), [partnerLoans])
  const loanIdKey = partnerLoanIds.join('|')
  const queriedLoanPayments = useLiveQuery(
    () =>
      partnerLoanIds.length > 0
        ? db.loan_payments
            .where('loanId')
            .anyOf(partnerLoanIds)
            .and((payment) => !payment.isDeleted)
            .toArray()
        : [],
    [loanIdKey]
  )
  const loanPayments = useMemo(() => queriedLoanPayments ?? EMPTY_LOAN_PAYMENTS, [queriedLoanPayments])
  const salesAccountCommissionEntries = useMemo(
    () => (salesAccountAgent ? commissionEntries.filter((entry) => entry.agentId === salesAccountAgent.id) : []),
    [commissionEntries, salesAccountAgent]
  )
  const partnerInstallmentSales = useMemo(
    () => (partnerId ? installmentSales.filter((sale) => sale.customerBusinessPartnerId === partnerId) : []),
    [installmentSales, partnerId]
  )
  const salesAccountProductCommissionEntries = useMemo(
    () => (salesAccountAgent ? productCommissionEntries.filter((entry) => entry.agentId === salesAccountAgent.id) : []),
    [productCommissionEntries, salesAccountAgent]
  )

  const settlementTransactions = useMemo(() => {
    const salesOrderIds = new Set(
      partnerSalesOrders.filter((order) => !order.isDeleted && order.status !== 'cancelled').map((order) => order.id)
    )
    const purchaseOrderIds = new Set(
      partnerPurchaseOrders.filter((order) => !order.isDeleted && order.status !== 'cancelled').map((order) => order.id)
    )

    return paymentTransactions.filter((transaction) => {
      if (transaction.isDeleted) return false
      if (transaction.sourceType === 'sales_order') return salesOrderIds.has(transaction.sourceRecordId)
      if (transaction.sourceType === 'purchase_order') return purchaseOrderIds.has(transaction.sourceRecordId)
      if (
        (transaction.sourceType === 'installment_sale_down_payment' ||
          transaction.sourceType === 'installment_sale_installment') &&
        transaction.metadata?.businessPartnerId === partnerId
      )
        return true
      if (transaction.sourceType === 'agent_commission_payout') {
        return transaction.sourceRecordId === salesAccountAgent?.id
      }
      return (
        transaction.sourceType === 'direct_transaction' &&
        transaction.metadata?.businessPartnerId === partnerId &&
        isDirectTransactionPartnerAccountEffect(transaction.metadata?.partnerAccountEffect)
      )
    })
  }, [partnerId, partnerPurchaseOrders, partnerSalesOrders, paymentTransactions, salesAccountAgent?.id])

  const merchantDeliveryEntries = useMemo(() => {
    if (!partnerId) return []
    const merchantProfileIds = new Set(
      deliveryMerchantProfiles
        .filter((profile) => !profile.isDeleted && profile.businessPartnerId === partnerId)
        .map((profile) => profile.id)
    )
    const merchantKinds = new Set([
      'merchant_cod_payable',
      'merchant_cod_correction',
      'merchant_recipient_payout_correction',
      'merchant_fee',
      'merchant_recipient_payout',
      'merchant_payout',
      'merchant_repayment',
      'adjustment'
    ])

    return deliveryLedgerEntries.filter(
      (entry) =>
        !entry.isDeleted &&
        merchantKinds.has(entry.kind) &&
        ((entry.merchantProfileId != null && merchantProfileIds.has(entry.merchantProfileId)) ||
          entry.businessPartnerId === partnerId)
    )
  }, [deliveryLedgerEntries, deliveryMerchantProfiles, partnerId])

  const deliveryShipmentReferences = useMemo(
    () =>
      Object.fromEntries(
        deliveryShipments
          .filter((shipment) => !shipment.isDeleted)
          .map((shipment) => [shipment.id, shipment.trackingNumber])
      ),
    [deliveryShipments]
  )
  const deliverySettlementReferences = useMemo(
    () =>
      Object.fromEntries(
        deliverySettlements
          .filter((settlement) => !settlement.isDeleted)
          .map((settlement) => [settlement.id, settlement.settlementNumber])
      ),
    [deliverySettlements]
  )

  const statementData = useMemo<PartnerAccountStatementData | null>(() => {
    if (!partner) return null

    const allOrders = [...partnerSalesOrders, ...partnerPurchaseOrders]
    return {
      partnerId: partner.id,
      period,
      isAgentCommissionStatement: Boolean(salesAccountAgent),
      salesOrders: partnerSalesOrders,
      salesOrderReturns: partnerSalesOrderReturns,
      salesOrderReturnItems: partnerSalesOrderReturnItems,
      purchaseOrders: partnerPurchaseOrders,
      statementOrders: allOrders,
      loans: partnerLoans,
      loanPayments,
      installmentSales: partnerInstallmentSales,
      linkedOrderCodes: Object.fromEntries(
        allOrders.filter((order) => !order.isDeleted).map((order) => [order.id, order.orderNumber])
      ),
      settlementTransactions,
      agentCommissionEntries: salesAccountCommissionEntries,
      agentProductCommissionEntries: salesAccountProductCommissionEntries,
      deliveryLedgerEntries: merchantDeliveryEntries,
      deliveryShipmentReferences,
      deliverySettlementReferences
    }
  }, [
    deliverySettlementReferences,
    deliveryShipmentReferences,
    loanPayments,
    merchantDeliveryEntries,
    partner,
    partnerInstallmentSales,
    partnerLoans,
    partnerPurchaseOrders,
    partnerSalesOrderReturnItems,
    partnerSalesOrderReturns,
    partnerSalesOrders,
    period,
    salesAccountCommissionEntries,
    salesAccountProductCommissionEntries,
    settlementTransactions
  ])

  return {
    partner,
    statementData,
    sourceCounts: {
      orders: partnerSalesOrders.length + partnerPurchaseOrders.length + partnerInstallmentSales.length,
      loans: partnerLoans.length,
      payments: settlementTransactions.length + loanPayments.length + merchantDeliveryEntries.length
    }
  }
}

/**
 * Supplies invoice and print views with the Account Statement's current
 * all-time balances without collapsing currencies or falling back to cached
 * partner summary fields.
 */
export function usePartnerAccountStatementClosingBalances(
  workspaceId: string | undefined,
  partnerId: string | null | undefined
): PartnerAccountStatementClosingBalance[] | undefined {
  const { statementData } = usePartnerAccountStatement(workspaceId, partnerId, ALL_TIME_PERIOD)

  return useMemo(
    () => (statementData ? getPartnerAccountStatementClosingBalances(statementData) : undefined),
    [statementData]
  )
}
