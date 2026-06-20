import { describe, expect, it } from 'vitest'
import {
  buildClinicalAppointmentPaymentObligation,
  getClinicalAppointmentPaymentSummary,
  toUISaleFromPaidClinicalAppointment,
} from './clinicalAppointmentPayments'
import type { ClinicalAppointment, PaymentTransaction } from './models'

const appointment: ClinicalAppointment = {
  id: '11111111-2222-4333-8444-555555555555',
  workspaceId: 'workspace-1',
  createdAt: '2026-06-20T08:00:00.000Z',
  updatedAt: '2026-06-20T08:00:00.000Z',
  syncStatus: 'synced',
  lastSyncedAt: '2026-06-20T08:00:00.000Z',
  version: 1,
  isDeleted: false,
  patientId: 'patient-1',
  patientName: 'Test Client',
  patientPhone: null,
  isNewPatient: false,
  appointmentDate: '2026-06-20',
  startTime: '10:00',
  appointmentType: 'treatment',
  reasonForVisit: 'Hair treatment',
  consultationFee: 100,
  estimatedPrice: 100,
  currency: 'usd',
  status: 'completed',
  confirmationMethod: 'phone',
  priority: 'normal',
  internalNotes: null,
  createdBy: 'user-1',
}

function payment(
  id: string,
  amount: number,
  paidAt: string,
  reversalOfTransactionId: string | null = null,
): PaymentTransaction {
  return {
    id,
    workspaceId: appointment.workspaceId,
    createdAt: paidAt,
    updatedAt: paidAt,
    syncStatus: 'synced',
    lastSyncedAt: paidAt,
    version: 1,
    isDeleted: false,
    sourceModule: 'clinical_appointments',
    sourceType: 'clinical_appointment',
    sourceRecordId: appointment.id,
    sourceSubrecordId: null,
    direction: 'incoming',
    amount,
    currency: 'usd',
    paymentMethod: 'cash',
    paidAt,
    counterpartyName: appointment.patientName,
    referenceLabel: 'APT-11111111',
    createdBy: 'user-1',
    reversalOfTransactionId,
  }
}

describe('clinical appointment payments', () => {
  it('creates an open payment obligation for the service fee', () => {
    const obligation = buildClinicalAppointmentPaymentObligation(appointment, [])

    expect(obligation).toMatchObject({
      sourceModule: 'clinical_appointments',
      sourceType: 'clinical_appointment',
      amount: 100,
      currency: 'usd',
      counterpartyName: 'Test Client',
    })
  })

  it('keeps a partially paid appointment open for its remaining balance', () => {
    const transactions = [payment('payment-1', 40, '2026-06-20T10:30:00.000Z')]
    const summary = getClinicalAppointmentPaymentSummary(appointment, transactions)

    expect(summary).toMatchObject({ paidAmount: 40, balanceAmount: 60, isPaid: false, canCollect: true })
    expect(buildClinicalAppointmentPaymentObligation(appointment, transactions)?.amount).toBe(60)
    expect(toUISaleFromPaidClinicalAppointment(appointment, transactions)).toBeNull()
  })

  it('mirrors a fully paid appointment as one sale using the service fee', () => {
    const transactions = [
      payment('payment-1', 40, '2026-06-20T10:30:00.000Z'),
      payment('payment-2', 60, '2026-06-20T11:00:00.000Z'),
    ]
    const sale = toUISaleFromPaidClinicalAppointment(appointment, transactions)

    expect(sale).toMatchObject({
      id: appointment.id,
      origin: 'clinical_appointment',
      total_amount: 100,
      settlement_currency: 'usd',
      payment_method: 'cash',
      partyName: 'Test Client',
      _clinicalAppointmentId: appointment.id,
    })
    expect(sale?.items).toHaveLength(1)
    expect(sale?.items?.[0]).toMatchObject({
      product_name: 'Hair treatment',
      product_category: 'Appointment Services',
      unit_price: 100,
      cost_price: 0,
    })
  })

  it('removes a reversed payment from the paid balance and sales history', () => {
    const transactions = [
      payment('payment-1', 40, '2026-06-20T10:30:00.000Z'),
      payment('payment-2', 60, '2026-06-20T11:00:00.000Z'),
      payment('reversal-1', -60, '2026-06-20T11:30:00.000Z', 'payment-2'),
    ]

    expect(getClinicalAppointmentPaymentSummary(appointment, transactions)).toMatchObject({
      paidAmount: 40,
      balanceAmount: 60,
      isPaid: false,
    })
    expect(toUISaleFromPaidClinicalAppointment(appointment, transactions)).toBeNull()
  })

  it('does not collect payment for cancelled or no-show appointments', () => {
    for (const status of ['cancelled', 'no_show'] as const) {
      const summary = getClinicalAppointmentPaymentSummary({ ...appointment, status }, [])
      expect(summary.canCollect).toBe(false)
      expect(buildClinicalAppointmentPaymentObligation({ ...appointment, status }, [])).toBeNull()
    }
  })
})
