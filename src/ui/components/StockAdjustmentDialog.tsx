import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

import { createStockAdjustment, type Product, type StockAdjustmentReason } from "@/local-db";
import { isNonNegativeQuantity, quantitiesEqual, roundQuantity } from "@/lib/quantity";
import { cn, formatNumericInput, parseFormattedNumber, sanitizeNumericInput } from "@/lib/utils";
import { platformService } from "@/services/platformService";
import { ProductAutocompleteInput } from "@/ui/components/orders/ProductAutocompleteInput";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
    useToast,
} from "@/ui/components";

type AdjustmentFormState = {
    productId: string;
    storageId: string;
    quantity: string;
    reason: StockAdjustmentReason;
    notes: string;
};

const emptyAdjustmentForm: AdjustmentFormState = {
    productId: "",
    storageId: "",
    quantity: "",
    reason: "purchase",
    notes: "",
};

function groupKey(productId: string, storageId: string) {
    return `${productId}::${storageId}`;
}

function getAdjustmentReasonOptions(translate: (key: string, defaultValue: string) => string) {
    return [
        { value: "purchase" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.purchase", "Purchase") },
        { value: "return" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.return", "Return") },
        { value: "correction" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.correction", "Correction") },
        { value: "damage" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.damage", "Damage") },
        { value: "theft" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.theft", "Theft") },
        { value: "expired" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.expired", "Expired") },
        { value: "production" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.production", "Production") },
        { value: "other" as StockAdjustmentReason, label: translate("stockAdjustments.reasons.other", "Other") },
    ];
}

interface InventoryRow {
    productId: string;
    storageId: string;
    quantity: number;
}

interface Stock {
    id: string;
    name: string;
}

interface StockAdjustmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preselectedProductId?: string;
    products: Product[];
    storages: Stock[];
    inventory: InventoryRow[];
    workspaceId: string;
    userId: string | null;
}

export function StockAdjustmentDialog({
    open,
    onOpenChange,
    preselectedProductId,
    products,
    storages,
    inventory,
    workspaceId,
    userId,
}: StockAdjustmentDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();

    const reasonOptions = useMemo(() => getAdjustmentReasonOptions(t), [t]);

    const [search, setSearch] = useState("");
    const [form, setForm] = useState<AdjustmentFormState>(emptyAdjustmentForm);
    const [isSaving, setIsSaving] = useState(false);
    const seededSelectionKeyRef = useRef("");

    const productsById = useMemo(
        () => new Map(products.map((p) => [p.id, p] as const)),
        [products],
    );

    const inventoryByKey = useMemo(
        () =>
            new Map(
                inventory.map(
                    (row) => [groupKey(row.productId, row.storageId), row.quantity] as const,
                ),
            ),
        [inventory],
    );

    useEffect(() => {
        if (preselectedProductId && open && !form.productId) {
            const product = productsById.get(preselectedProductId);
            if (product) {
                setForm((prev) => ({ ...prev, productId: product.id }));
                setSearch(product.name);
            }
        }
    }, [preselectedProductId, open, form.productId, productsById]);

    const storageOptions = useMemo(() => {
        if (!form.productId) return storages;
        const storageIds = Array.from(
            new Set(
                inventory
                    .filter((row) => row.productId === form.productId)
                    .map((row) => row.storageId),
            ),
        );
        return storageIds.length
            ? storages.filter((s) => storageIds.includes(s.id))
            : storages;
    }, [form.productId, inventory, storages]);

    useEffect(() => {
        if (
            open &&
            storageOptions.length &&
            !storageOptions.some((s) => s.id === form.storageId)
        ) {
            setForm((current) => ({ ...current, storageId: storageOptions[0].id }));
        }
    }, [open, form.storageId, storageOptions]);

    const selectionKey =
        form.productId && form.storageId
            ? groupKey(form.productId, form.storageId)
            : "";
    const availableQuantity = selectionKey
        ? (inventoryByKey.get(selectionKey) ?? 0)
        : null;
    const targetQuantity =
        form.quantity === "" ? null : parseFormattedNumber(form.quantity);
    const quantityDelta =
        availableQuantity === null ||
        targetQuantity === null ||
        !isNonNegativeQuantity(targetQuantity)
            ? null
            : roundQuantity(targetQuantity - availableQuantity);
    const deltaMeta =
        quantityDelta === null || quantitiesEqual(quantityDelta, 0)
            ? null
            : quantityDelta > 0
                ? {
                    badge: `+${quantityDelta}`,
                    inputClassName: "border-emerald-500/40 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30",
                    textClassName: "text-emerald-700",
                    badgeClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
                }
                : {
                    badge: `-${Math.abs(quantityDelta)}`,
                    inputClassName: "border-rose-500/40 focus-visible:border-rose-500 focus-visible:ring-rose-500/30",
                    textClassName: "text-rose-700",
                    badgeClassName: "border-rose-500/20 bg-rose-500/10 text-rose-700",
                };
    const isIncrease = quantityDelta !== null && quantityDelta > 0;

    useEffect(() => {
        if (!open) {
            seededSelectionKeyRef.current = "";
            return;
        }
        if (!selectionKey || selectionKey === seededSelectionKeyRef.current) return;
        seededSelectionKeyRef.current = selectionKey;
        setForm((current) => ({
            ...current,
            quantity: String(inventoryByKey.get(selectionKey) ?? 0),
        }));
    }, [open, selectionKey, inventoryByKey]);

    const canSave =
        !!form.productId &&
        !!form.storageId &&
        targetQuantity !== null &&
        isNonNegativeQuantity(targetQuantity) &&
        quantityDelta !== null &&
        !quantitiesEqual(quantityDelta, 0);

    const resetForm = () => {
        setForm(emptyAdjustmentForm);
        setSearch("");
        setIsSaving(false);
    };

    const handleSave = async () => {
        if (!workspaceId || availableQuantity === null || targetQuantity === null || !isNonNegativeQuantity(targetQuantity)) return;

        const delta = roundQuantity(targetQuantity - availableQuantity);
        if (quantitiesEqual(delta, 0)) return;

        setIsSaving(true);
        try {
            await createStockAdjustment(workspaceId, {
                productId: form.productId,
                storageId: form.storageId,
                adjustmentType: delta > 0 ? "increase" : "decrease",
                quantity: Math.abs(delta),
                reason: form.reason,
                notes: form.notes,
                createdBy: userId ?? null,
            });
            toast({
                title: t("stockAdjustments.messages.adjustmentSaved", "Adjustment saved"),
                description: t("stockAdjustments.messages.adjustmentSavedDesc", "Inventory and audit log were updated."),
            });
            onOpenChange(false);
            resetForm();
        } catch (error) {
            toast({
                title: t("stockAdjustments.messages.adjustmentFailed", "Unable to save adjustment"),
                description: error instanceof Error ? error.message : t("stockAdjustments.messages.genericError", "Something went wrong."),
                variant: "destructive",
            });
            setIsSaving(false);
        }
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void handleSave();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(open) => {
                onOpenChange(open);
                if (!open) resetForm();
            }}
        >
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-3xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)] sm:rounded-[1.75rem]">
                <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-start sm:px-6 sm:py-5">
                    <DialogTitle>{t("stockAdjustments.dialog.adjustment.title", "New Stock Adjustment")}</DialogTitle>
                    <DialogDescription>
                        {t("stockAdjustments.dialog.adjustment.description", "Pick the product and storage, then set the final stock quantity you want to keep there.")}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
                        <div className="grid gap-4">
                            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                {preselectedProductId ? (() => {
                                    const product = productsById.get(preselectedProductId);
                                    return (
                                        <div className="space-y-2">
                                            <Label>{t("stockAdjustments.dialog.adjustment.product", "Product")}</Label>
                                            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                                                    {product?.imageUrl ? (
                                                        <img src={platformService.convertFileSrc(product.imageUrl)} alt={product.name} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <Package className="h-5 w-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate font-medium">{product?.name ?? "Loading..."}</div>
                                                    {product?.sku ? (
                                                        <div className="truncate text-xs text-muted-foreground">SKU: {product.sku}</div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })() : (
                                    <div className="space-y-2">
                                        <Label htmlFor="adjustment-search">{t("stockAdjustments.dialog.adjustment.productSearch", "Product search")}</Label>
                                        <ProductAutocompleteInput
                                            value={search}
                                            onChange={(value) => {
                                                setSearch(value);
                                                setForm((current) => ({ ...current, productId: "" }));
                                            }}
                                            onSelectProduct={(product) => {
                                                setForm((current) => ({ ...current, productId: product.id }));
                                                setSearch(product.name);
                                            }}
                                            products={products}
                                            placeholder={t("stockAdjustments.dialog.adjustment.productSearchPlaceholder", "Search products by name or SKU")}
                                            hasSelection={!!form.productId}
                                        />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label>{t("stockAdjustments.dialog.adjustment.storage", "Storage")}</Label>
                                    <Select
                                        value={form.storageId}
                                        onValueChange={(value) =>
                                            setForm((current) => ({ ...current, storageId: value }))
                                        }
                                    >
                                        <SelectTrigger className="rounded-xl">
                                            <SelectValue placeholder={t("stockAdjustments.dialog.adjustment.selectStorage", "Select storage")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {storageOptions.map((storage) => (
                                                <SelectItem key={storage.id} value={storage.id}>
                                                    {storage.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Label htmlFor="adjustment-quantity">
                                            {t("stockAdjustments.dialog.adjustment.finalQuantity", "Final Quantity")}
                                        </Label>
                                        {availableQuantity !== null ? (
                                            <span className="text-xs text-muted-foreground">
                                                {t("stockAdjustments.dialog.adjustment.currentAvailable", "Current available {{value}}", { value: formatNumericInput(String(availableQuantity)) })}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="relative">
                                        <Input
                                            id="adjustment-quantity"
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="0"
                                            disabled={!selectionKey}
                                            value={formatNumericInput(form.quantity)}
                                            onChange={(event) =>
                                                setForm((current) => ({
                                                    ...current,
                                                    quantity: sanitizeNumericInput(event.target.value, {
                                                        allowDecimal: true,
                                                    }),
                                                }))
                                            }
                                            className={cn("pr-20", deltaMeta?.inputClassName)}
                                        />
                                        {deltaMeta ? (
                                            <span
                                                className={cn(
                                                    "pointer-events-none absolute inset-y-0 right-3 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                                                    deltaMeta.badgeClassName,
                                                )}
                                            >
                                                {isIncrease ? (
                                                    <ArrowUp className="h-3 w-3" />
                                                ) : (
                                                    <ArrowDown className="h-3 w-3" />
                                                )}
                                                {deltaMeta.badge}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className={cn("text-xs", deltaMeta?.textClassName || "text-muted-foreground")}>
                                        {!selectionKey
                                            ? t("stockAdjustments.dialog.adjustment.selectPrompt", "Select a product and storage to load the current quantity.")
                                            : targetQuantity === null
                                                ? t("stockAdjustments.dialog.adjustment.enterQuantity", "Enter the final quantity you want after this adjustment.")
: quantitiesEqual(quantityDelta ?? 0, 0)
                                                     ? t("stockAdjustments.dialog.adjustment.noChange", "No change yet. Adjust the quantity above to create an entry.")
                                                     : quantityDelta && quantityDelta > 0
                                                        ? t("stockAdjustments.dialog.adjustment.increaseBy", "Increase by {{delta}}. {{available}} -> {{target}}.", { delta: formatNumericInput(String(quantityDelta)), available: formatNumericInput(String(availableQuantity ?? 0)), target: formatNumericInput(String(targetQuantity)) })
                                                        : t("stockAdjustments.dialog.adjustment.decreaseBy", "Decrease by {{delta}}. {{available}} -> {{target}}.", { delta: formatNumericInput(String(Math.abs(quantityDelta ?? 0))), available: formatNumericInput(String(availableQuantity ?? 0)), target: formatNumericInput(String(targetQuantity ?? 0)) })}
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t("stockAdjustments.dialog.adjustment.reason", "Reason")}</Label>
                                    <Select
                                        value={form.reason}
                                        onValueChange={(value) =>
                                            setForm((current) => ({ ...current, reason: value as StockAdjustmentReason }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {reasonOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="adjustment-notes">{t("stockAdjustments.dialog.adjustment.notes", "Notes")}</Label>
                                <Textarea
                                    id="adjustment-notes"
                                    value={form.notes}
                                    onChange={(event) =>
                                        setForm((current) => ({ ...current, notes: event.target.value }))
                                    }
                                    rows={4}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="border-t bg-muted/20 px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:justify-between sm:px-6">
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => onOpenChange(false)}
                            disabled={isSaving}
                        >
                            {t("stockAdjustments.dialog.adjustment.cancel", "Cancel")}
                        </Button>
                        <Button
                            type="submit"
                            className="w-full sm:w-auto"
                            disabled={!canSave || isSaving}
                        >
                            {isSaving
                                ? t("stockAdjustments.dialog.adjustment.saving", "Saving...")
                                : t("stockAdjustments.dialog.adjustment.save", "Save Adjustment")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
