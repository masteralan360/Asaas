import type { Sale } from '@/types'
import type {
  ClinicalAppointment,
  PaymentObligation,
  PaymentTransaction,
} from './models'

const PAYMENT_EPSILON = 0.000001

export interface ClinicalAppointmentPaymentSummary {
  serviceFee: number
  paidAmount: number
  balanceAmount: number
  isPaid: boolean
  canCollect: boolean
  activeTransactions: PaymentTransaction[]
}

export type ClinicalAppointmentSale = Sale & {
  partyName?: string | null
  _clinicalAppointmentId: string
}

function getAppointmentReference(appointment: ClinicalAppointment) {
  return `APT-${appointment.id.slice(0, 8).toUpperCase()}`
}

function getAppointmentServiceName(appointment: ClinicalAppointment) {
  return appointment.reasonForVisit?.trim()
    || appointment.serviceProcedure?.trim()
    || appointment.appointmentType.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function getActiveClinicalAppointmentPaymentTransactions(
  appointmentId: string,
  transactions: PaymentTransaction[],
) {
  const relevant = transactions.filter((transaction) =>
    !transaction.isDeleted
    && transaction.sourceType === 'clinical_appointment'
    && transaction.sourceRecordId === appointmentId
  )
  const reversedIds = new Set(
    relevant
      .filter((transaction) => !!transaction.reversalOfTransactionId)
      .map((transaction) => transaction.reversalOfTransactionId as string),
  )

  return relevant
    .filter((transaction) => !transaction.reversalOfTransactionId && !reversedIds.has(transaction.id))
    .sort((left, right) => left.paidAt.localeCompare(right.paidAt) || left.createdAt.localeCompare(right.createdAt))
}

export function getClinicalAppointmentPaymentSummary(
  appointment: ClinicalAppointment,
  transactions: PaymentTransaction[],
): ClinicalAppointmentPaymentSummary {
  const serviceFee = Math.max(0, Number(appointment.consultationFee || 0))
  const activeTransactions = getActiveClinicalAppointmentPaymentTransactions(appointment.id, transactions)
  const paidAmount = activeTransactions.reduce(
    (total, transaction) => total + Math.max(0, Number(transaction.amount || 0)),
    0,
  )
  const balanceAmount = Math.max(0, serviceFee - paidAmount)
  const isPaid = serviceFee > 0 && balanceAmount <= PAYMENT_EPSILON
  const canCollect = serviceFee > 0
    && !isPaid
    && appointment.status !== 'cancelled'
    && appointment.status !== 'no_show'

  return {
    serviceFee,
    paidAmount,
    balanceAmount,
    isPaid,
    canCollect,
    activeTransactions,
  }
}

export function buildClinicalAppointmentPaymentObligation(
  appointment: ClinicalAppointment,
  transactions: PaymentTransaction[],
): PaymentObligation | null {
  const summary = getClinicalAppointmentPaymentSummary(appointment, transactions)
  if (!summary.canCollect || summary.balanceAmount <= PAYMENT_EPSILON) {
    return null
  }

  const reference = getAppointmentReference(appointment)
  return {
    id: `clinical-appointment:${appointment.id}`,
    workspaceId: appointment.workspaceId,
    sourceModule: 'clinical_appointments',
    sourceType: 'clinical_appointment',
    sourceRecordId: appointment.id,
    sourceSubrecordId: null,
    direction: 'incoming',
    amount: summary.balanceAmount,
    currency: appointment.currency || 'usd',
    dueDate: appointment.appointmentDate,
    counterpartyName: appointment.patientName,
    referenceLabel: reference,
    title: appointment.patientName,
    subtitle: getAppointmentServiceName(appointment),
    status: appointment.appointmentDate < new Date().toISOString().slice(0, 10) ? 'overdue' : 'open',
    routePath: `/clinical-appointments/${appointment.id}/edit`,
    metadata: {
      appointmentId: appointment.id,
      appointmentType: appointment.appointmentType,
      requestedService: appointment.reasonForVisit || appointment.serviceProcedure || null,
      serviceFee: summary.serviceFee,
    },
  }
}

export function toUISaleFromPaidClinicalAppointment(
  appointment: ClinicalAppointment,
  transactions: PaymentTransaction[],
): ClinicalAppointmentSale | null {
  const summary = getClinicalAppointmentPaymentSummary(appointment, transactions)
  if (!summary.isPaid || summary.activeTransactions.length === 0) {
    return null
  }

  const latestPayment = summary.activeTransactions[summary.activeTransactions.length - 1]
  const serviceName = getAppointmentServiceName(appointment)
  const numericSequence = Number.parseInt(appointment.id.replace(/-/g, '').slice(0, 8), 16)
  const paymentMethod = latestPayment.paymentMethod === 'cash'
    || latestPayment.paymentMethod === 'fib'
    || latestPayment.paymentMethod === 'qicard'
    || latestPayment.paymentMethod === 'zaincash'
    || latestPayment.paymentMethod === 'fastpay'
    || latestPayment.paymentMethod === 'loan'
    || latestPayment.paymentMethod === 'bank_transfer'
    ? latestPayment.paymentMethod
    : undefined

  return {
    id: appointment.id,
    workspace_id: appointment.workspaceId,
    cashier_id: latestPayment.createdBy || appointment.createdBy || '',
    total_amount: summary.serviceFee,
    settlement_currency: latestPayment.currency || appointment.currency || 'usd',
    created_at: latestPayment.paidAt,
    updated_at: latestPayment.updatedAt,
    origin: 'clinical_appointment',
    payment_method: paymentMethod,
    cashier_name: 'Appointments',
    items: [{
      id: `clinical-service:${appointment.id}`,
      sale_id: appointment.id,
      product_id: 'clinical_appointment_service',
      product_name: serviceName,
      product_sku: 'APPOINTMENT-SERVICE',
      product_category: 'Appointment Services',
      quantity: 1,
      unit_price: summary.serviceFee,
      total_price: summary.serviceFee,
      cost_price: 0,
      converted_cost_price: 0,
      original_currency: latestPayment.currency || appointment.currency || 'usd',
      original_unit_price: summary.serviceFee,
      converted_unit_price: summary.serviceFee,
      settlement_currency: latestPayment.currency || appointment.currency || 'usd',
      returned_quantity: 0,
      is_returned: false,
      product: {
        name: serviceName,
        sku: 'APPOINTMENT-SERVICE',
        category: 'Appointment Services',
        can_be_returned: false,
      },
    }],
    is_returned: false,
    sequenceId: Number.isFinite(numericSequence) ? numericSequence : undefined,
    notes: latestPayment.note || appointment.internalNotes || undefined,
    partyName: appointment.patientName,
    _clinicalAppointmentId: appointment.id,
  }
}
