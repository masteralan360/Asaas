import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'

import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { type PriceBook } from '@/local-db'
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, useToast } from '@/ui/components'
import { cn } from '@/lib/utils'
import {
    getRetriableActionToast,
    isRetriableWebRequestError,
    normalizeSupabaseActionError,
    runSupabaseAction
} from '@/lib/supabaseRequest'

type CatalogRule = {
    id: string
    rule_type: 'inclusion' | 'exclusion'
    price_book_id: string | null
    override_prices: boolean
}

type StorefrontCatalogRulesEditorProps = {
    workspaceId: string | null
    storefrontId: string | null
    priceBooks: PriceBook[]
    disabled?: boolean
}

export function StorefrontCatalogRulesEditor({
    workspaceId,
    storefrontId,
    priceBooks,
    disabled = false
}: StorefrontCatalogRulesEditorProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { isSupabaseConfigured } = useAuth()
    const [rules, setRules] = useState<CatalogRule[]>([])
    const [ruleType, setRuleType] = useState<'inclusion' | 'exclusion'>('inclusion')
    const [ruleTarget, setRuleTarget] = useState<string>('native')
    const [isLoading, setIsLoading] = useState(false)
    const [isActionPending, setIsActionPending] = useState(false)

    const showActionError = (error: unknown, fallbackDescription: string) => {
        const normalized = normalizeSupabaseActionError(error)
        if (isRetriableWebRequestError(normalized)) {
            const message = getRetriableActionToast(normalized)
            toast({
                title: message.title,
                description: message.description,
                variant: 'destructive'
            })
            return
        }

        toast({
            title: t('common.error') || 'Error',
            description: fallbackDescription || normalized.message,
            variant: 'destructive'
        })
    }

    const priceBookById = useCallback(
        () => new Map(priceBooks.map((priceBook) => [priceBook.id, priceBook] as const)),
        [priceBooks]
    )

    const loadRules = useCallback(async () => {
        if (!workspaceId || disabled || !isSupabaseConfigured) {
            setRules([])
            return
        }

        setIsLoading(true)
        try {
            const query = supabase
                .from('workspace_storefront_catalog_rules')
                .select('id, rule_type, price_book_id, override_prices')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: true })

            const result = storefrontId
                ? await runSupabaseAction('marketplace.fetchCatalogRules', () =>
                    query.eq('storefront_id', storefrontId),
                    { timeoutMs: 10000, platform: 'all' })
                : await runSupabaseAction('marketplace.fetchCatalogRules', () =>
                    query.is('storefront_id', null),
                    { timeoutMs: 10000, platform: 'all' })

            if (result.error) {
                throw result.error
            }

            setRules((result.data ?? []) as CatalogRule[])
        } catch (error) {
            console.error('[StorefrontCatalogRules] Failed to load catalog rules:', error)
        } finally {
            setIsLoading(false)
        }
    }, [disabled, isSupabaseConfigured, storefrontId, workspaceId])

    useEffect(() => {
        void loadRules()
    }, [loadRules])

    const handleAddRule = async () => {
        if (!workspaceId) return

        setIsActionPending(true)
        try {
            const result = await runSupabaseAction('marketplace.addCatalogRule', () =>
                supabase
                    .from('workspace_storefront_catalog_rules')
                    .insert({
                        workspace_id: workspaceId,
                        storefront_id: storefrontId,
                        rule_type: ruleType,
                        price_book_id: ruleTarget === 'native' ? null : ruleTarget
                    })
                    .select('id, rule_type, price_book_id')
                    .single(),
                { timeoutMs: 10000, platform: 'all' })

            if (result.error) {
                throw result.error
            }

            await loadRules()
            toast({
                title: t('common.success') || 'Success',
                description: t('settings.marketplace.catalogRuleAdded', {
                    defaultValue: 'Catalog rule added.'
                })
            })
        } catch (error) {
            showActionError(error, t('settings.marketplace.catalogRuleAddError', {
                defaultValue: 'Failed to add storefront catalog rule.'
            }))
        } finally {
            setIsActionPending(false)
        }
    }

    const handleRemoveRule = async (ruleId: string) => {
        if (!workspaceId) return

        setIsActionPending(true)
        try {
            const result = await runSupabaseAction('marketplace.removeCatalogRule', () =>
                supabase
                    .from('workspace_storefront_catalog_rules')
                    .delete()
                    .eq('id', ruleId)
                    .eq('workspace_id', workspaceId),
                { timeoutMs: 10000, platform: 'all' })

            if (result.error) {
                throw result.error
            }

            setRules((current) => current.filter((rule) => rule.id !== ruleId))
            toast({
                title: t('common.success') || 'Success',
                description: t('settings.marketplace.catalogRuleRemoved', {
                    defaultValue: 'Catalog rule removed.'
                })
            })
        } catch (error) {
            showActionError(error, t('settings.marketplace.catalogRuleRemoveError', {
                defaultValue: 'Failed to remove storefront catalog rule.'
            }))
        } finally {
            setIsActionPending(false)
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-1">
                <Label className="text-sm font-semibold">
                    {t('settings.marketplace.catalogRules', { defaultValue: 'Storefront Catalog' })}
                </Label>
                <p className="text-xs text-muted-foreground">
                    {t('settings.marketplace.catalogRulesDesc', {
                        defaultValue: 'Include only specific products on your storefront, or exclude products by price book. Native products are items not listed in any price book.'
                    })}
                </p>
                <p className="text-xs text-muted-foreground">
                    {t('settings.marketplace.catalogRuleOverrideHint', {
                        defaultValue: 'Price book rules can override storefront prices with the price book\'s prices. Only one rule per storefront can override prices.'
                    })}
                </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                    value={ruleType}
                    onValueChange={(value) => setRuleType(value as 'inclusion' | 'exclusion')}
                    disabled={disabled || isActionPending}
                >
                    <SelectTrigger className="w-full sm:w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="inclusion">
                            {t('settings.marketplace.catalogRuleInclusion', { defaultValue: 'Include only' })}
                        </SelectItem>
                        <SelectItem value="exclusion">
                            {t('settings.marketplace.catalogRuleExclusion', { defaultValue: 'Exclude' })}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Select
                    value={ruleTarget}
                    onValueChange={setRuleTarget}
                    disabled={disabled || isActionPending}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="native">
                            {t('settings.marketplace.catalogRuleNative', { defaultValue: 'Native products (no price book)' })}
                        </SelectItem>
                        {priceBooks.map((priceBook) => (
                            <SelectItem key={priceBook.id} value={priceBook.id}>
                                {priceBook.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddRule}
                    disabled={disabled || isActionPending}
                    className="gap-2"
                >
                    <Plus className="h-4 w-4" />
                    {t('settings.marketplace.catalogRuleAdd', { defaultValue: 'Add Rule' })}
                </Button>
            </div>

            {isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t('common.loading', { defaultValue: 'Loading...' })}
                </div>
            )}

            {rules.length > 0 && (
                <div className="space-y-2">
                    {rules.map((rule) => {
                        const priceBookName = rule.price_book_id
                            ? (priceBookById().get(rule.price_book_id)?.name ?? 'Unavailable')
                            : t('settings.marketplace.catalogRuleNative', { defaultValue: 'Native products (no price book)' })

    const handleToggleOverridePrices = async (rule: CatalogRule, enabled: boolean) => {
        if (!workspaceId) return

        setIsActionPending(true)
        try {
            const result = await runSupabaseAction('marketplace.toggleCatalogRulePriceOverride', () =>
                supabase
                    .from('workspace_storefront_catalog_rules')
                    .update({ override_prices: enabled })
                    .eq('id', rule.id)
                    .eq('workspace_id', workspaceId),
                { timeoutMs: 10000, platform: 'all' })

            if (result.error) {
                throw result.error
            }

            await loadRules()
            toast({
                title: t('common.success') || 'Success',
                description: enabled
                    ? t('settings.marketplace.catalogRuleOverrideEnabled', {
                        defaultValue: 'Price override enabled. The storefront will use this price book\'s prices.'
                    })
                    : t('settings.marketplace.catalogRuleOverrideDisabled', {
                        defaultValue: 'Price override disabled.'
                    })
            })
        } catch (error) {
            await loadRules()
            showActionError(error, t('settings.marketplace.catalogRuleOverrideError', {
                defaultValue: 'Failed to update the price override.'
            }))
        } finally {
            setIsActionPending(false)
        }
    }

    return (
                            <div
                                key={rule.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/70 px-3 py-2"
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className={cn(
                                        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold',
                                        rule.rule_type === 'inclusion'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                                            : 'bg-destructive/10 text-destructive'
                                    )}>
                                        {rule.rule_type === 'inclusion'
                                            ? t('settings.marketplace.catalogRuleInclusion', { defaultValue: 'Include only' })
                                            : t('settings.marketplace.catalogRuleExclusion', { defaultValue: 'Exclude' })}
                                    </span>
                                    <span className="truncate text-sm font-medium">{priceBookName}</span>
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                    {rule.price_book_id && (
                                        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                                            <Switch
                                                checked={rule.override_prices}
                                                onCheckedChange={(checked) => handleToggleOverridePrices(rule, checked)}
                                                disabled={disabled || isActionPending}
                                            />
                                            {t('settings.marketplace.catalogRuleOverridePrices', { defaultValue: 'Override prices' })}
                                        </label>
                                    )}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleRemoveRule(rule.id)}
                                        disabled={disabled || isActionPending}
                                        title={t('settings.marketplace.catalogRuleRemove', { defaultValue: 'Remove rule' })}
                                        className="h-8 w-8"
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}