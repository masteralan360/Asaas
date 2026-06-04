import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { isOnline } from '@/lib/network'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import { generateId, toSnakeCase } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { db } from './database'
import { addToOfflineMutations, fetchTableFromSupabase } from './hooks'
import type {
    CurrencyCode,
    ExchangeFeeRule,
    ExchangeFeeRuleSnapshot,
    ExchangeFeeRuleTransactionScope,
    ExchangeFeeType,
    ExchangePaymentMethod,
    ExchangeRateSnapshot,
    ExchangeTransaction,
    ExchangeTransactionType
} from './models'

const TRANSACTIONS_TABLE = 'exchange_transactions'
const FEE_RULES_TABLE = 'exchange_fee_rules'

type ExchangeTableName = typeof TRANSACTIONS_TABLE | typeof FEE_RULES_TABLE
type ExchangeSyncEntity = Record<string, unknown> & {
    id: string
    workspaceId: string
    version: number
}

const tableByName = {
    [TRANSACTIONS_TABLE]: db.exchange_transactions,
    [FEE_RULES_TABLE]: db.exchange_fee_rules
} as const

export interface ExchangeRateMap {
    usd: number
    eur?: number | null
    try?: number | null
}

export interface ExchangeCalculationInput {
    fromCurrency: CurrencyCode
    toCurrency: CurrencyCode
    customerGivesAmount: number
    ratesToIqd: ExchangeRateMap
    feeType?: ExchangeFeeType | null
    feeCurrency?: CurrencyCode | null
    feeValue?: number | null
    feeBasisAmount?: number | null
}

export interface ExchangeCalculationResult {
    baseReceivesAmount: number
    customerReceivesAmount: number
    feeAmount: number
    feeAmountInToCurrency: number
}

export interface CreateExchangeTransactionInput {
    transactionType: ExchangeTransactionType
    transactionDate?: string
    fromCurrency: CurrencyCode
    toCurrency: CurrencyCode
    customerGivesAmount: number
    ratesToIqd: ExchangeRateMap
    exchangeRateUsed: number
    exchangeRateSource: string
    exchangeRateManuallyEdited: boolean
    marketRateSnapshot: ExchangeRateSnapshot[]
    feeRuleId?: string | null
    feeRuleSnapshot?: ExchangeFeeRuleSnapshot | null
    feeType?: ExchangeFeeType | null
    feeCurrency?: CurrencyCode | null
    originalFeeValue?: number | null
    finalFeeValue?: number | null
    feeBasisAmount?: number | null
    paymentMethod: ExchangePaymentMethod
    employeeUserId?: string | null
    employeeName?: string | null
    notes?: string | null
    createdBy?: string | null
}

export interface SaveExchangeFeeRuleInput {
    name: string
    transactionScope: ExchangeFeeRuleTransactionScope
    feeType: ExchangeFeeType
    currency: CurrencyCode
    value: number
    customerGivesBasisAmount: number
    effectiveStartDate: string
    effectiveEndDate?: string | null
    isActive: boolean
    isLocked: boolean
    notes?: string | null
    createdBy?: string | null
}

function shouldUseCloudBusinessData(workspaceId?: string | null) {
    return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return {
            syncStatus: 'synced' as const,
            lastSyncedAt: timestamp
        }
    }

    return {
        syncStatus: 'pending' as const,
        lastSyncedAt: null
    }
}

function roundCurrencyAmount(value: number, currency: CurrencyCode) {
    const precision = currency === 'iqd' ? 0 : 2
    const multiplier = 10 ** precision
    return Math.round((Number(value) || 0) * multiplier) / multiplier
}

export function getDefaultExchangeFeeBasisAmount(currency: CurrencyCode) {
    return currency === 'iqd' ? 100000 : 100
}

export function getExchangeFeeBasisAmount(rule: { currency?: CurrencyCode | null; customerGivesBasisAmount?: number | null } | null | undefined, fallbackCurrency: CurrencyCode = 'iqd') {
    const currency = rule?.currency || fallbackCurrency
    const basisAmount = Number(rule?.customerGivesBasisAmount || 0)
    return basisAmount > 0 ? basisAmount : getDefaultExchangeFeeBasisAmount(currency)
}

function normalizeDateKey(value?: string | null) {
    if (!value) {
        return new Date().toISOString().slice(0, 10)
    }

    return value.slice(0, 10)
}

function normalizeOptionalText(value?: string | null) {
    const text = String(value || '').trim()
    return text || null
}

function getQuotedRateToIqd(currency: CurrencyCode, rates: ExchangeRateMap) {
    if (currency === 'iqd') return 1
    const rate = rates[currency]
    if (!rate || rate <= 0) {
        throw new Error(`Missing ${currency.toUpperCase()}/IQD exchange rate`)
    }
    return rate
}

function getUnitRateToIqd(currency: CurrencyCode, rates: ExchangeRateMap) {
    if (currency === 'iqd') return 1
    return getQuotedRateToIqd(currency, rates) / 100
}

export function convertExchangeAmount(
    amount: number,
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    ratesToIqd: ExchangeRateMap
) {
    if (fromCurrency === toCurrency) {
        return Number(amount) || 0
    }

    const fromRate = getUnitRateToIqd(fromCurrency, ratesToIqd)
    const toRate = getUnitRateToIqd(toCurrency, ratesToIqd)
    return (Number(amount) || 0) * fromRate / toRate
}

export function calculateExchangeTransaction(input: ExchangeCalculationInput): ExchangeCalculationResult {
    const customerGivesAmount = Math.max(0, Number(input.customerGivesAmount || 0))
    const feeValue = Math.max(0, Number(input.feeValue || 0))
    const feeCurrency = input.feeCurrency || input.fromCurrency
    const feeBasisAmount = Math.max(0, Number(input.feeBasisAmount || 0)) || getDefaultExchangeFeeBasisAmount(feeCurrency)

    const baseReceivesAmount = convertExchangeAmount(
        customerGivesAmount,
        input.fromCurrency,
        input.toCurrency,
        input.ratesToIqd
    )

    let feeAmount = 0
    if (input.feeType === 'fixed') {
        const customerGivesInFeeCurrency = convertExchangeAmount(customerGivesAmount, input.fromCurrency, feeCurrency, input.ratesToIqd)
        feeAmount = roundCurrencyAmount(feeValue * customerGivesInFeeCurrency / feeBasisAmount, feeCurrency)
    } else if (input.feeType === 'percentage') {
        const customerGivesInFeeCurrency = convertExchangeAmount(customerGivesAmount, input.fromCurrency, feeCurrency, input.ratesToIqd)
        feeAmount = roundCurrencyAmount(customerGivesInFeeCurrency * feeValue / 100, feeCurrency)
    }

    const feeAmountInToCurrency = feeAmount > 0
        ? convertExchangeAmount(feeAmount, feeCurrency, input.toCurrency, input.ratesToIqd)
        : 0
    const customerReceivesAmount = Math.max(0, baseReceivesAmount - feeAmountInToCurrency)

    return {
        baseReceivesAmount: roundCurrencyAmount(baseReceivesAmount, input.toCurrency),
        customerReceivesAmount: roundCurrencyAmount(customerReceivesAmount, input.toCurrency),
        feeAmount: roundCurrencyAmount(feeAmount, feeCurrency),
        feeAmountInToCurrency: roundCurrencyAmount(feeAmountInToCurrency, input.toCurrency)
    }
}

export function buildExchangeFeeRuleSnapshot(rule: ExchangeFeeRule): ExchangeFeeRuleSnapshot {
    return {
        id: rule.id,
        name: rule.name,
        transactionScope: rule.transactionScope,
        feeType: rule.feeType,
        currency: rule.currency,
        value: rule.value,
        customerGivesBasisAmount: getExchangeFeeBasisAmount(rule),
        effectiveStartDate: rule.effectiveStartDate,
        effectiveEndDate: rule.effectiveEndDate ?? null,
        isLocked: rule.isLocked
    }
}

export function getEffectiveExchangeRateUsed(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    ratesToIqd: ExchangeRateMap
) {
    if (fromCurrency === toCurrency) return 1
    if (fromCurrency === 'iqd') return getQuotedRateToIqd(toCurrency, ratesToIqd)
    return getQuotedRateToIqd(fromCurrency, ratesToIqd)
}

async function generateExchangeTransactionNo(workspaceId: string, createdAt: string) {
    const year = createdAt.slice(0, 4)
    const rows = await db.exchange_transactions.where('workspaceId').equals(workspaceId).toArray()
    const sequence = rows.filter((row) => row.createdAt.startsWith(`${year}-`)).length + 1
    return `FX-${year}-${String(sequence).padStart(5, '0')}`
}

function sanitizeSyncPayload(entity: Record<string, unknown>) {
    const payload = toSnakeCase(entity)
    delete payload.sync_status
    delete payload.last_synced_at

    for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) {
            delete payload[key]
        }
    }

    return payload
}

async function markEntitiesSynced(tableName: ExchangeTableName, ids: string[]) {
    if (ids.length === 0) {
        return
    }

    const table = tableByName[tableName]
    const syncedAt = new Date().toISOString()
    await Promise.all(ids.map((id) =>
        table.update(id, {
            syncStatus: 'synced',
            lastSyncedAt: syncedAt
        } as never)
    ))
}

async function queueOfflineUpserts(tableName: ExchangeTableName, entities: ExchangeSyncEntity[]) {
    await Promise.all(entities.map((entity) =>
        addToOfflineMutations(
            tableName,
            entity.id,
            entity.version > 1 ? 'update' : 'create',
            entity,
            entity.workspaceId
        )
    ))
}

async function syncUpsertEntities(tableName: ExchangeTableName, entities: ExchangeSyncEntity[], workspaceId: string) {
    if (!entities.length || !shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await queueOfflineUpserts(tableName, entities)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const payload = entities.map((entity) => sanitizeSyncPayload(entity))
        const { error } = await runSupabaseAction(`${tableName}.sync`, () =>
            client.from(tableName).upsert(payload)
        ) as any
        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, entities.map((entity) => entity.id))
    } catch (error) {
        console.error(`[CurrencyExchange] Failed to sync ${tableName}:`, error)
        await queueOfflineUpserts(tableName, entities)
    }
}

async function syncSoftDelete(tableName: ExchangeTableName, entityId: string, workspaceId: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId }, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const { error } = await runSupabaseAction(`${tableName}.delete`, () =>
            client
                .from(tableName)
                .update({ is_deleted: true, updated_at: new Date().toISOString() })
                .eq('id', entityId)
        ) as any

        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, [entityId])
    } catch (error) {
        console.error(`[CurrencyExchange] Failed to delete ${tableName}:`, error)
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId }, workspaceId)
    }
}

export function resolveEffectiveExchangeFeeRule(
    rules: ExchangeFeeRule[],
    transactionType: ExchangeTransactionType,
    transactionDate: string,
    feeCurrency?: CurrencyCode
) {
    const dateKey = normalizeDateKey(transactionDate)
    return rules
        .filter((rule) =>
            !rule.isDeleted
            && rule.isActive
            && (rule.transactionScope === 'both' || rule.transactionScope === transactionType)
            && (!feeCurrency || rule.currency === feeCurrency)
            && normalizeDateKey(rule.effectiveStartDate) <= dateKey
            && (!rule.effectiveEndDate || normalizeDateKey(rule.effectiveEndDate) >= dateKey)
        )
        .sort((left, right) =>
            normalizeDateKey(right.effectiveStartDate).localeCompare(normalizeDateKey(left.effectiveStartDate))
            || right.updatedAt.localeCompare(left.updatedAt)
        )[0] || null
}

export async function createExchangeTransaction(
    workspaceId: string,
    input: CreateExchangeTransactionInput
) {
    const now = new Date().toISOString()
    const transactionDate = input.transactionDate ? new Date(input.transactionDate).toISOString() : now
    const fromCurrency = input.fromCurrency
    const toCurrency = input.toCurrency
    const customerGivesAmount = roundCurrencyAmount(Math.max(0, Number(input.customerGivesAmount || 0)), fromCurrency)
    const feeType = input.feeType ?? input.feeRuleSnapshot?.feeType ?? null
    const feeCurrency = input.feeCurrency ?? input.feeRuleSnapshot?.currency ?? null
    const originalFeeValue = input.originalFeeValue ?? input.feeRuleSnapshot?.value ?? null
    const finalFeeValue = Math.max(0, Number(input.finalFeeValue ?? originalFeeValue ?? 0))
    const feeBasisAmount = Math.max(0, Number(input.feeBasisAmount ?? input.feeRuleSnapshot?.customerGivesBasisAmount ?? 0))

    if (!workspaceId) {
        throw new Error('Workspace is required')
    }
    if (fromCurrency === toCurrency) {
        throw new Error('From currency and To currency must be different')
    }
    if (customerGivesAmount <= 0) {
        throw new Error('Customer gives amount must be greater than zero')
    }
    if (!input.exchangeRateUsed || input.exchangeRateUsed <= 0) {
        throw new Error('Exchange rate is required')
    }
    if (!input.marketRateSnapshot.length) {
        throw new Error('Market rate snapshot is required')
    }

    const calculation = calculateExchangeTransaction({
        fromCurrency,
        toCurrency,
        customerGivesAmount,
        ratesToIqd: input.ratesToIqd,
        feeType,
        feeCurrency,
        feeValue: finalFeeValue,
        feeBasisAmount
    })

    const transactionId = generateId()
    const transactionNo = await generateExchangeTransactionNo(workspaceId, now)
    const feeEdited = Boolean(
        input.feeRuleSnapshot
        && !input.feeRuleSnapshot.isLocked
        && originalFeeValue !== null
        && Math.abs(Number(originalFeeValue) - finalFeeValue) > 0.000001
    )
    const transaction: ExchangeTransaction = {
        id: transactionId,
        workspaceId,
        transactionNo,
        transactionType: input.transactionType,
        transactionDate,
        fromCurrency,
        toCurrency,
        customerGivesAmount,
        customerReceivesAmount: calculation.customerReceivesAmount,
        exchangeRateUsed: input.exchangeRateUsed,
        exchangeRateSource: input.exchangeRateSource,
        exchangeRateManuallyEdited: input.exchangeRateManuallyEdited,
        marketRateSnapshot: input.marketRateSnapshot,
        feeRuleId: input.feeRuleId ?? input.feeRuleSnapshot?.id ?? null,
        feeRuleSnapshot: input.feeRuleSnapshot ?? null,
        feeType,
        feeCurrency,
        originalFeeValue,
        finalFeeValue,
        feeAmount: calculation.feeAmount,
        feeEdited,
        paymentMethod: input.paymentMethod,
        employeeUserId: input.employeeUserId ?? null,
        employeeName: normalizeOptionalText(input.employeeName),
        notes: normalizeOptionalText(input.notes),
        createdBy: input.createdBy || null,
        createdAt: now,
        updatedAt: now,
        version: 1,
        isDeleted: false,
        ...getSyncMetadata(workspaceId, now)
    }

    await db.exchange_transactions.put(transaction)
    await syncUpsertEntities(TRANSACTIONS_TABLE, [transaction as unknown as ExchangeSyncEntity], workspaceId)

    const savedTransaction = await db.exchange_transactions.get(transaction.id)
    return savedTransaction || transaction
}

export async function createExchangeFeeRule(workspaceId: string, input: SaveExchangeFeeRuleInput) {
    const now = new Date().toISOString()
    const name = input.name.trim()
    const value = Math.max(0, Number(input.value || 0))
    const customerGivesBasisAmount = Math.max(0, Number(input.customerGivesBasisAmount || 0))

    if (!workspaceId) {
        throw new Error('Workspace is required')
    }
    if (!name) {
        throw new Error('Rule name is required')
    }
    if (value <= 0) {
        throw new Error('Fee value must be greater than zero')
    }
    if (customerGivesBasisAmount <= 0) {
        throw new Error('Customer gives basis amount must be greater than zero')
    }
    if (!input.effectiveStartDate) {
        throw new Error('Effective start date is required')
    }

    const rule: ExchangeFeeRule = {
        id: generateId(),
        workspaceId,
        name,
        transactionScope: input.transactionScope,
        feeType: input.feeType,
        currency: input.currency,
        value,
        customerGivesBasisAmount,
        effectiveStartDate: normalizeDateKey(input.effectiveStartDate),
        effectiveEndDate: input.effectiveEndDate ? normalizeDateKey(input.effectiveEndDate) : null,
        isActive: input.isActive,
        isLocked: input.isLocked,
        notes: normalizeOptionalText(input.notes),
        createdBy: input.createdBy || null,
        createdAt: now,
        updatedAt: now,
        version: 1,
        isDeleted: false,
        ...getSyncMetadata(workspaceId, now)
    }

    await db.exchange_fee_rules.put(rule)
    await syncUpsertEntities(FEE_RULES_TABLE, [rule as unknown as ExchangeSyncEntity], workspaceId)
    return await db.exchange_fee_rules.get(rule.id) || rule
}

export async function updateExchangeFeeRule(ruleId: string, input: Partial<SaveExchangeFeeRuleInput>) {
    const existing = await db.exchange_fee_rules.get(ruleId)
    if (!existing || existing.isDeleted) {
        throw new Error('Fee rule not found')
    }

    const now = new Date().toISOString()
    const nextValue = input.value !== undefined
        ? Math.max(0, Number(input.value || 0))
        : existing.value
    const nextBasisAmount = input.customerGivesBasisAmount !== undefined
        ? Math.max(0, Number(input.customerGivesBasisAmount || 0))
        : getExchangeFeeBasisAmount(existing)

    if (input.name !== undefined && !input.name.trim()) {
        throw new Error('Rule name is required')
    }
    if (nextValue <= 0) {
        throw new Error('Fee value must be greater than zero')
    }
    if (nextBasisAmount <= 0) {
        throw new Error('Customer gives basis amount must be greater than zero')
    }

    const updated: ExchangeFeeRule = {
        ...existing,
        ...input,
        name: input.name !== undefined ? input.name.trim() : existing.name,
        value: nextValue,
        customerGivesBasisAmount: nextBasisAmount,
        effectiveStartDate: input.effectiveStartDate ? normalizeDateKey(input.effectiveStartDate) : existing.effectiveStartDate,
        effectiveEndDate: input.effectiveEndDate !== undefined
            ? (input.effectiveEndDate ? normalizeDateKey(input.effectiveEndDate) : null)
            : existing.effectiveEndDate,
        notes: input.notes !== undefined ? normalizeOptionalText(input.notes) : existing.notes,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.exchange_fee_rules.put(updated)
    await syncUpsertEntities(FEE_RULES_TABLE, [updated as unknown as ExchangeSyncEntity], existing.workspaceId)
    return updated
}

export async function deleteExchangeFeeRule(ruleId: string) {
    const existing = await db.exchange_fee_rules.get(ruleId)
    if (!existing || existing.isDeleted) {
        return
    }

    const now = new Date().toISOString()
    const deleted: ExchangeFeeRule = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.exchange_fee_rules.put(deleted)
    await syncSoftDelete(FEE_RULES_TABLE, existing.id, existing.workspaceId)
}

export async function deleteExchangeTransaction(transactionId: string) {
    const existing = await db.exchange_transactions.get(transactionId)
    if (!existing || existing.isDeleted) {
        return
    }

    const now = new Date().toISOString()
    const deleted: ExchangeTransaction = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.exchange_transactions.put(deleted)
    await syncSoftDelete(TRANSACTIONS_TABLE, existing.id, existing.workspaceId)
}

export function useExchangeTransactions(workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const transactions = useLiveQuery(
        () => workspaceId
            ? db.exchange_transactions
                .where('workspaceId')
                .equals(workspaceId)
                .and((item) => !item.isDeleted)
                .reverse()
                .sortBy('createdAt')
            : [],
        [workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase(TRANSACTIONS_TABLE, db.exchange_transactions, workspaceId)
        }
    }, [online, workspaceId])

    return transactions ?? []
}

export function useExchangeTransaction(transactionId: string | undefined) {
    return useLiveQuery(
        () => transactionId ? db.exchange_transactions.get(transactionId) : undefined,
        [transactionId]
    )
}

export function useExchangeFeeRules(workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const rules = useLiveQuery(
        () => workspaceId
            ? db.exchange_fee_rules
                .where('workspaceId')
                .equals(workspaceId)
                .and((item) => !item.isDeleted)
                .reverse()
                .sortBy('updatedAt')
            : [],
        [workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase(FEE_RULES_TABLE, db.exchange_fee_rules, workspaceId)
        }
    }, [online, workspaceId])

    return rules ?? []
}
