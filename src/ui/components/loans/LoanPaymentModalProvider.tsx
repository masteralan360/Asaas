import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '@/auth'
import { db } from '@/local-db/database'
import { useLoans } from '@/local-db'
import { RecordLoanPaymentModal } from './RecordLoanPaymentModal'

interface LoanPaymentModalContextValue {
    activeLoanId: string | null
    isPaymentModalOpen: boolean
    openLoanPayment: (loanId: string, options?: { installmentId?: string | null }) => void
    closeLoanPayment: () => void
}

const LoanPaymentModalContext = createContext<LoanPaymentModalContextValue | null>(null)

export function LoanPaymentModalProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth()
    const workspaceId = user?.workspaceId
    const loans = useLoans(workspaceId)
    const [activeLoanId, setActiveLoanId] = useState<string | null>(null)
    const [activeInstallmentId, setActiveInstallmentId] = useState<string | null>(null)
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)

    const activeLoan = useMemo(
        () => activeLoanId ? loans.find(item => item.id === activeLoanId) ?? null : null,
        [activeLoanId, loans]
    )
    const activeInstallment = useLiveQuery(
        () => activeInstallmentId ? db.loan_installments.get(activeInstallmentId) : undefined,
        [activeInstallmentId]
    ) ?? null

    useEffect(() => {
        setActiveLoanId(null)
        setActiveInstallmentId(null)
        setIsPaymentModalOpen(false)
    }, [workspaceId])

    const openLoanPayment = (loanId: string, options?: { installmentId?: string | null }) => {
        setActiveLoanId(loanId)
        setActiveInstallmentId(options?.installmentId ?? null)
        setIsPaymentModalOpen(true)
    }

    const closeLoanPayment = () => {
        setIsPaymentModalOpen(false)
        setActiveLoanId(null)
        setActiveInstallmentId(null)
    }

    const handlePaymentModalOpenChange = (open: boolean) => {
        setIsPaymentModalOpen(open)
        if (!open) {
            setActiveLoanId(null)
            setActiveInstallmentId(null)
        }
    }

    return (
        <LoanPaymentModalContext.Provider
            value={{
                activeLoanId,
                isPaymentModalOpen,
                openLoanPayment,
                closeLoanPayment
            }}
        >
            {children}
            {workspaceId && (
                <RecordLoanPaymentModal
                    isOpen={isPaymentModalOpen}
                    onOpenChange={handlePaymentModalOpenChange}
                    workspaceId={workspaceId}
                    loan={activeLoan}
                    selectedInstallment={activeInstallment}
                />
            )}
        </LoanPaymentModalContext.Provider>
    )
}

export function useLoanPaymentModal() {
    const context = useContext(LoanPaymentModalContext)
    if (!context) {
        throw new Error('useLoanPaymentModal must be used within LoanPaymentModalProvider')
    }

    return context
}
