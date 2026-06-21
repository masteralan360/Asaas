import { describe, expect, it } from 'vitest'

import type { Loan, LoanInstallment } from '@/local-db/models'
import { buildOverdueLoanReminderItems } from './loanReminders'

function loan(): Loan {
    return {
        id: 'loan-1',
        workspaceId: 'workspace-1',
        saleId: null,
        loanNo: 'LN-1',
        source: 'manual',
        loanCategory: 'standard',
        direction: 'lent',
        borrowerName: 'Borrower',
        borrowerPhone: '',
        borrowerAddress: '',
        borrowerNationalId: '',
        principalAmount: 100,
        totalPaidAmount: 0,
        balanceAmount: 100,
        settlementCurrency: 'usd',
        installmentCount: 2,
        installmentFrequency: 'monthly',
        firstDueDate: null,
        nextDueDate: null,
        status: 'active',
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: '2000-01-01T00:00:00.000Z',
        version: 1,
        isDeleted: false
    }
}

function installment(id: string, dueDate: string | null): LoanInstallment {
    return {
        id,
        workspaceId: 'workspace-1',
        loanId: 'loan-1',
        installmentNo: id === 'undated' ? 1 : 2,
        dueDate,
        plannedAmount: 50,
        paidAmount: 0,
        balanceAmount: 50,
        status: 'unpaid',
        paidAt: null,
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: '2000-01-01T00:00:00.000Z',
        version: 1,
        isDeleted: false
    }
}

describe('loan reminders', () => {
    it('does not create reminders for installments without a due date', () => {
        expect(buildOverdueLoanReminderItems([loan()], [installment('undated', null)])).toEqual([])
    })

    it('still creates reminders for dated overdue installments', () => {
        const items = buildOverdueLoanReminderItems([loan()], [
            installment('undated', null),
            installment('dated', '2000-01-01')
        ])

        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ installmentId: 'dated', dueDate: '2000-01-01' })
    })
})
