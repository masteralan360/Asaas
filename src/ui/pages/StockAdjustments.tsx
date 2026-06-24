import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Boxes,
  History,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/auth";
import { useWorkspace } from "@/workspace";
import {
  createStockAdjustment,
  createStockBatch,
  deleteStockBatch,
  filterStockAdjustments,
  updateStockBatch,
  useInventory,
  useInventoryTransactions,
  useProducts,
  useStockAdjustments,
  useStockBatches,
  useStorages,
  type CurrencyCode,
  type InventoryTransaction,
  type StockAdjustmentReason,
  type StockAdjustmentType,
  type StockBatch,
} from "@/local-db";
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatLocalDateValue,
  formatNumericInput,
  parseFormattedNumber,
  parseLocalDateValue,
  sanitizeNumericInput,
} from "@/lib/utils";
import { ProductAutocompleteInput } from "@/ui/components/orders/ProductAutocompleteInput";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CurrencySelector,
  DateTimePicker,
  DeleteConfirmationModal,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from "@/ui/components";

type ActiveTab = "adjustments" | "batches";

type AdjustmentFormState = {
  productId: string;
  storageId: string;
  quantity: string;
  reason: StockAdjustmentReason;
  notes: string;
};

type BatchFormState = {
  id?: string;
  productId: string;
  storageId: string;
  batchNumber: string;
  quantity: string;
  price: string;
  costPrice: string;
  currency: CurrencyCode;
  expiryDate: string;
  manufacturingDate: string;
  notes: string;
};

function getAdjustmentReasonOptions(
  translate: (key: string, defaultValue: string) => string,
) {
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

const emptyAdjustmentForm: AdjustmentFormState = {
  productId: "",
  storageId: "",
  quantity: "",
  reason: "purchase",
  notes: "",
};

const emptyBatchForm: BatchFormState = {
  productId: "",
  storageId: "",
  batchNumber: "",
  quantity: "",
  price: "",
  costPrice: "",
  currency: "usd",
  expiryDate: "",
  manufacturingDate: "",
  notes: "",
};

function groupKey(productId: string, storageId: string) {
  return `${productId}::${storageId}`;
}

function getReasonLabel(
  reason: StockAdjustmentReason,
  translate?: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
) {
  const fallback = reason.charAt(0).toUpperCase() + reason.slice(1);
  if (!translate) {
    return fallback;
  }
  return translate(`stockAdjustments.reasons.${reason}`, fallback);
}

function getExpiryBadge(
  expiryDate?: string | null,
  t?: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
) {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  const days = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  if (days < 0)
    return {
      label: t ? t("stockAdjustments.expired", "Expired") : "Expired",
      className: "border-rose-500/20 bg-rose-500/10 text-rose-700",
    };
  if (days <= 30)
    return {
      label: t
        ? t("stockAdjustments.nearExpiry", "Near expiry • {{days}}d", { days })
        : `Near expiry • ${days}d`,
      className: "border-amber-500/20 bg-amber-500/10 text-amber-700",
    };
  return null;
}

const transactionTypeLabels: Record<string, string> = {
  stock_adjustment: "Stock Adjustment",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  initial_stock: "Initial Stock",
};

function mapTransactionLabel(
  transaction: InventoryTransaction,
  translate?: (key: string, defaultValue: string) => string,
) {
  if (!translate) {
    return transactionTypeLabels[transaction.transactionType] || transaction.transactionType.replace(/_/g, " ");
  }
  return translate(
    `stockAdjustments.transactionType.${transaction.transactionType}`,
    transactionTypeLabels[transaction.transactionType] || transaction.transactionType.replace(/_/g, " "),
  );
}

export function StockAdjustments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasCapability } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = user?.workspaceId;
  const canEdit = user?.role === "admin" || user?.role === "staff";
  const canManageStockBatches = hasCapability("stockBatches");

  const products = useProducts(workspaceId);
  const storages = useStorages(workspaceId);
  const inventory = useInventory(workspaceId);
  const adjustments = useStockAdjustments(workspaceId);
  const batches = useStockBatches(workspaceId);
  const transactions = useInventoryTransactions(workspaceId);

  const reasonOptions = useMemo(() => getAdjustmentReasonOptions(t), [t]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("adjustments");
  const [productFilter, setProductFilter] = useState("all");
  const [storageFilter, setStorageFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | StockAdjustmentType>(
    "all",
  );
  const [reasonFilter, setReasonFilter] = useState<
    "all" | StockAdjustmentReason
  >("all");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [adjustmentSearch, setAdjustmentSearch] = useState("");
  const [adjustmentForm, setAdjustmentForm] =
    useState<AdjustmentFormState>(emptyAdjustmentForm);
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);

  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchForm, setBatchForm] = useState<BatchFormState>(emptyBatchForm);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState<StockBatch | null>(null);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const adjustmentSeededSelectionKeyRef = useRef("");

  useEffect(() => {
    if (!canManageStockBatches && activeTab === "batches") {
      setActiveTab("adjustments");
    }
  }, [activeTab, canManageStockBatches]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product] as const)),
    [products],
  );
  const storagesById = useMemo(
    () => new Map(storages.map((storage) => [storage.id, storage] as const)),
    [storages],
  );
  const inventoryByKey = useMemo(
    () =>
      new Map(
        inventory.map(
          (row) =>
            [groupKey(row.productId, row.storageId), row.quantity] as const,
        ),
      ),
    [inventory],
  );

  const filteredProductsForBatch = useMemo(() => {
    const needle = batchSearch.trim().toLowerCase();
    return products.filter(
      (product) =>
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle),
    );
  }, [batchSearch, products]);

  const adjustmentStorageOptions = useMemo(() => {
    if (!adjustmentForm.productId) return storages;
    const storageIds = Array.from(
      new Set(
        inventory
          .filter((row) => row.productId === adjustmentForm.productId)
          .map((row) => row.storageId),
      ),
    );
    return storageIds.length
      ? storages.filter((storage) => storageIds.includes(storage.id))
      : storages;
  }, [adjustmentForm.productId, inventory, storages]);

  const batchStorageOptions = useMemo(() => {
    if (!batchForm.productId) return storages;
    const storageIds = Array.from(
      new Set(
        inventory
          .filter((row) => row.productId === batchForm.productId)
          .map((row) => row.storageId),
      ),
    );
    return storageIds.length
      ? storages.filter((storage) => storageIds.includes(storage.id))
      : storages;
  }, [batchForm.productId, inventory, storages]);

  useEffect(() => {
    if (
      adjustmentDialogOpen &&
      adjustmentStorageOptions.length &&
      !adjustmentStorageOptions.some(
        (storage) => storage.id === adjustmentForm.storageId,
      )
    ) {
      setAdjustmentForm((current) => ({
        ...current,
        storageId: adjustmentStorageOptions[0].id,
      }));
    }
  }, [
    adjustmentDialogOpen,
    adjustmentForm.storageId,
    adjustmentStorageOptions,
  ]);

  useEffect(() => {
    if (
      batchDialogOpen &&
      batchStorageOptions.length &&
      !batchStorageOptions.some((storage) => storage.id === batchForm.storageId)
    ) {
      setBatchForm((current) => ({
        ...current,
        storageId: batchStorageOptions[0].id,
      }));
    }
  }, [batchDialogOpen, batchForm.storageId, batchStorageOptions]);

  const adjustmentSelectionKey =
    adjustmentForm.productId && adjustmentForm.storageId
      ? groupKey(adjustmentForm.productId, adjustmentForm.storageId)
      : "";
  const adjustmentAvailableQuantity = adjustmentSelectionKey
    ? (inventoryByKey.get(adjustmentSelectionKey) ?? 0)
    : null;
  const adjustmentTargetQuantity =
    adjustmentForm.quantity === ""
      ? null
      : parseFormattedNumber(adjustmentForm.quantity);
  const adjustmentQuantityDelta =
    adjustmentAvailableQuantity === null ||
    adjustmentTargetQuantity === null ||
    !Number.isInteger(adjustmentTargetQuantity)
      ? null
      : adjustmentTargetQuantity - adjustmentAvailableQuantity;
  const adjustmentDeltaMeta =
    adjustmentQuantityDelta === null || adjustmentQuantityDelta === 0
      ? null
      : adjustmentQuantityDelta > 0
        ? {
            badge: `+${adjustmentQuantityDelta}`,
            inputClassName:
              "border-emerald-500/40 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30",
            textClassName: "text-emerald-700",
            badgeClassName:
              "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
          }
        : {
            badge: `-${Math.abs(adjustmentQuantityDelta)}`,
            inputClassName:
              "border-rose-500/40 focus-visible:border-rose-500 focus-visible:ring-rose-500/30",
            textClassName: "text-rose-700",
            badgeClassName: "border-rose-500/20 bg-rose-500/10 text-rose-700",
          };
  const isAdjustmentIncrease =
    adjustmentQuantityDelta !== null && adjustmentQuantityDelta > 0;
  const batchSelectionKey =
    batchForm.productId && batchForm.storageId
      ? groupKey(batchForm.productId, batchForm.storageId)
      : "";
  const batchInventoryQuantity = batchSelectionKey
    ? (inventoryByKey.get(batchSelectionKey) ?? 0)
    : null;
  const batchPriceValue =
    batchForm.price === "" ? null : parseFormattedNumber(batchForm.price);
  const batchCostPriceValue =
    batchForm.costPrice === ""
      ? null
      : parseFormattedNumber(batchForm.costPrice);
  const selectedBatchProduct = batchForm.productId
    ? productsById.get(batchForm.productId)
    : null;
  const batchUsesCustomPricing =
    !!selectedBatchProduct &&
    (selectedBatchProduct.price !== batchPriceValue ||
      selectedBatchProduct.costPrice !== batchCostPriceValue ||
      selectedBatchProduct.currency !== batchForm.currency);

  useEffect(() => {
    if (!adjustmentDialogOpen) {
      adjustmentSeededSelectionKeyRef.current = "";
      return;
    }

    if (
      !adjustmentSelectionKey ||
      adjustmentSelectionKey === adjustmentSeededSelectionKeyRef.current
    ) {
      return;
    }

    adjustmentSeededSelectionKeyRef.current = adjustmentSelectionKey;
    setAdjustmentForm((current) => ({
      ...current,
      quantity: String(inventoryByKey.get(adjustmentSelectionKey) ?? 0),
    }));
  }, [adjustmentDialogOpen, adjustmentSelectionKey, inventoryByKey]);

  const filteredAdjustments = useMemo(
    () =>
      filterStockAdjustments(adjustments, {
        productId: productFilter === "all" ? null : productFilter,
        storageId: storageFilter === "all" ? null : storageFilter,
        adjustmentType: typeFilter === "all" ? null : typeFilter,
        reason: reasonFilter === "all" ? null : reasonFilter,
        startDate,
        endDate,
      }),
    [
      adjustments,
      endDate,
      productFilter,
      reasonFilter,
      startDate,
      storageFilter,
      typeFilter,
    ],
  );

  const batchGroups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        productId: string;
        storageId: string;
        rows: StockBatch[];
        batchQuantity: number;
      }
    >();
    for (const batch of batches) {
      const key = groupKey(batch.productId, batch.storageId);
      const group = grouped.get(key);
      if (group) {
        group.rows.push(batch);
        group.batchQuantity += batch.quantity;
      } else {
        grouped.set(key, {
          productId: batch.productId,
          storageId: batch.storageId,
          rows: [batch],
          batchQuantity: batch.quantity,
        });
      }
    }

    return Array.from(grouped.values()).sort((left, right) => {
      const leftName = productsById.get(left.productId)?.name || "";
      const rightName = productsById.get(right.productId)?.name || "";
      return (
        leftName.localeCompare(rightName) ||
        left.storageId.localeCompare(right.storageId)
      );
    });
  }, [batches, productsById]);

  const recentTransactions = useMemo(
    () =>
      transactions
        .filter((transaction) =>
          [
            "stock_adjustment",
            "transfer_in",
            "transfer_out",
            "initial_stock",
          ].includes(transaction.transactionType),
        )
        .slice(0, 12),
    [transactions],
  );

  const canSaveAdjustment =
    !!adjustmentForm.productId &&
    !!adjustmentForm.storageId &&
    adjustmentTargetQuantity !== null &&
    Number.isInteger(adjustmentTargetQuantity) &&
    adjustmentTargetQuantity >= 0 &&
    adjustmentQuantityDelta !== null &&
    adjustmentQuantityDelta !== 0;
  const canSaveBatch =
    !!batchForm.productId &&
    !!batchForm.storageId &&
    !!batchForm.batchNumber.trim() &&
    Number.isInteger(parseFormattedNumber(batchForm.quantity || "")) &&
    parseFormattedNumber(batchForm.quantity || "") > 0 &&
    batchPriceValue !== null &&
    Number.isFinite(batchPriceValue) &&
    batchPriceValue >= 0 &&
    batchCostPriceValue !== null &&
    Number.isFinite(batchCostPriceValue) &&
    batchCostPriceValue >= 0;

  const resetAdjustmentForm = () => {
    setAdjustmentForm(emptyAdjustmentForm);
    setAdjustmentSearch("");
    setIsSavingAdjustment(false);
  };

  const resetBatchForm = () => {
    setBatchForm(emptyBatchForm);
    setBatchSearch("");
    setIsSavingBatch(false);
  };

  const handleSaveAdjustment = async () => {
    if (
      !workspaceId ||
      adjustmentAvailableQuantity === null ||
      adjustmentTargetQuantity === null ||
      !Number.isInteger(adjustmentTargetQuantity)
    )
      return;

    const quantityDelta =
      adjustmentTargetQuantity - adjustmentAvailableQuantity;
    if (quantityDelta === 0) return;

    setIsSavingAdjustment(true);
    try {
      await createStockAdjustment(workspaceId, {
        productId: adjustmentForm.productId,
        storageId: adjustmentForm.storageId,
        adjustmentType: quantityDelta > 0 ? "increase" : "decrease",
        quantity: Math.abs(quantityDelta),
        reason: adjustmentForm.reason,
        notes: adjustmentForm.notes,
        createdBy: user?.id ?? null,
      });
      toast({
        title: t("stockAdjustments.messages.adjustmentSaved", "Adjustment saved"),
        description: t("stockAdjustments.messages.adjustmentSavedDesc", "Inventory and audit log were updated."),
      });
      setAdjustmentDialogOpen(false);
      resetAdjustmentForm();
    } catch (error) {
      toast({
        title: t("stockAdjustments.messages.adjustmentFailed", "Unable to save adjustment"),
        description:
          error instanceof Error ? error.message : t("stockAdjustments.messages.genericError", "Something went wrong."),
        variant: "destructive",
      });
      setIsSavingAdjustment(false);
    }
  };

  const handleSaveBatch = async () => {
    if (!workspaceId || !canManageStockBatches) return;
    setIsSavingBatch(true);
    try {
      const payload = {
        productId: batchForm.productId,
        storageId: batchForm.storageId,
        batchNumber: batchForm.batchNumber,
        quantity: parseFormattedNumber(batchForm.quantity),
        price: parseFormattedNumber(batchForm.price),
        costPrice: parseFormattedNumber(batchForm.costPrice),
        currency: batchForm.currency,
        expiryDate: batchForm.expiryDate || null,
        manufacturingDate: batchForm.manufacturingDate || null,
        notes: batchForm.notes,
      };

      if (batchForm.id) {
        await updateStockBatch(batchForm.id, payload);
        toast({
          title: t("stockAdjustments.messages.batchUpdated", "Batch updated"),
          description: t("stockAdjustments.messages.batchUpdatedDesc", "Batch changes were saved."),
        });
      } else {
        await createStockBatch(workspaceId, payload);
        toast({
          title: t("stockAdjustments.messages.batchCreated", "Batch created"),
          description: t("stockAdjustments.messages.batchCreatedDesc", "New batch added successfully."),
        });
      }

      setBatchDialogOpen(false);
      resetBatchForm();
    } catch (error) {
      toast({
        title: t("stockAdjustments.messages.batchFailed", "Unable to save batch"),
        description:
          error instanceof Error ? error.message : t("stockAdjustments.messages.genericError", "Something went wrong."),
        variant: "destructive",
      });
      setIsSavingBatch(false);
    }
  };

  const handleDeleteBatch = async () => {
    if (!batchToDelete || !canManageStockBatches) return;
    setIsDeletingBatch(true);
    try {
      await deleteStockBatch(batchToDelete.id);
      toast({
        title: t("stockAdjustments.messages.batchDeleted", "Batch deleted"),
        description: t("stockAdjustments.messages.batchDeletedDesc", "The batch was removed from active tracking."),
      });
      setBatchToDelete(null);
    } catch (error) {
      toast({
        title: t("stockAdjustments.messages.batchDeleteFailed", "Unable to delete batch"),
        description:
          error instanceof Error ? error.message : t("stockAdjustments.messages.genericError", "Something went wrong."),
        variant: "destructive",
      });
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const handleAdjustmentSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSaveAdjustment();
  };

  const handleBatchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSaveBatch();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Boxes className="h-6 w-6 text-primary" />
            {t("nav.stockAdjustments", { defaultValue: "Stock Adjustments" })}
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            {canManageStockBatches
              ? t("stockAdjustments.pageSubtitle", "Record manual stock changes, manage product batches, and review the unified inventory log.")
              : t("stockAdjustments.pageSubtitleSimple", "Record manual stock changes and review the unified inventory log.")}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              className="gap-2 rounded-xl"
              onClick={() => {
                resetAdjustmentForm();
                setAdjustmentDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("stockAdjustments.newAdjustment", "New Stock Adjustment")}
            </Button>
            {canManageStockBatches && (
              <Button
                variant="outline"
                className="gap-2 rounded-xl"
                onClick={() => {
                  resetBatchForm();
                  setBatchDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t("stockAdjustments.newBatch", "New Stock Batch")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "batches" && !canManageStockBatches) return;
          setActiveTab(value as ActiveTab);
        }}
        className="space-y-6"
      >
        <TabsList className={cn(
          "grid h-auto min-h-12 w-full rounded-2xl items-stretch",
          canManageStockBatches ? "max-w-xl grid-cols-2" : "max-w-xs grid-cols-1",
        )}>
          <TabsTrigger value="adjustments" className="min-h-10">
            {t("stockAdjustments.tabs.adjustments", "Stock Adjustments")}
          </TabsTrigger>
          {canManageStockBatches && (
            <TabsTrigger value="batches" className="min-h-10">
              {t("stockAdjustments.tabs.batches", "Stock Batches")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="adjustments" className="space-y-6">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle>{t("stockAdjustments.filters.title", "Filters")}</CardTitle>
              <CardDescription>
                {t("stockAdjustments.filters.description", "Filter by product, storage, type, reason, or date range.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.product", "Product")}</Label>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("stockAdjustments.filters.allProducts", "All products")}</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.storage", "Storage")}</Label>
                <Select value={storageFilter} onValueChange={setStorageFilter}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("stockAdjustments.filters.allStorages", "All storages")}</SelectItem>
                    {storages.map((storage) => (
                      <SelectItem key={storage.id} value={storage.id}>
                        {storage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.type", "Type")}</Label>
                <Select
                  value={typeFilter}
                  onValueChange={(value) =>
                    setTypeFilter(value as "all" | StockAdjustmentType)
                  }
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("stockAdjustments.filters.allTypes", "All types")}</SelectItem>
                    <SelectItem value="increase">{t("stockAdjustments.filters.increase", "Increase")}</SelectItem>
                    <SelectItem value="decrease">{t("stockAdjustments.filters.decrease", "Decrease")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.reason", "Reason")}</Label>
                <Select
                  value={reasonFilter}
                  onValueChange={(value) =>
                    setReasonFilter(value as "all" | StockAdjustmentReason)
                  }
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("stockAdjustments.filters.allReasons", "All reasons")}</SelectItem>
                    {reasonOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.start", "Start")}</Label>
                <DateTimePicker
                  mode="date"
                  date={startDate}
                  setDate={setStartDate}
                  placeholder={t("stockAdjustments.filters.startDate", "Start date")}
                  buttonClassName="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("stockAdjustments.filters.end", "End")}</Label>
                <DateTimePicker
                  mode="date"
                  date={endDate}
                  setDate={setEndDate}
                  placeholder={t("stockAdjustments.filters.endDate", "End date")}
                  buttonClassName="rounded-xl"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle>{t("stockAdjustments.history.title", "Adjustment history")}</CardTitle>
              <CardDescription>
                {t("stockAdjustments.history.description", "Each entry shows the before and after quantity snapshot for the selected storage.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredAdjustments.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("stockAdjustments.history.empty", "No adjustments match the current filters.")}
                </div>
              ) : (
                filteredAdjustments.map((adjustment) => {
                  const isIncrease = adjustment.adjustmentType === "increase";
                  return (
                    <div
                      key={adjustment.id}
                      className="rounded-2xl border border-border/60 bg-background/70 p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">
                              {productsById.get(adjustment.productId)?.name ||
                                t("inventoryTransfer.transactions.unknownProduct", "Unknown product")}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
                                isIncrease
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                                  : "border-rose-500/20 bg-rose-500/10 text-rose-700",
                              )}
                            >
                              {isIncrease ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )}
                              {adjustment.adjustmentType === "increase"
                                ? t("stockAdjustments.filters.increase", "Increase")
                                : t("stockAdjustments.filters.decrease", "Decrease")}
                            </span>
                            <span className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                              {getReasonLabel(adjustment.reason, t)}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {storagesById.get(adjustment.storageId)?.name ||
                              t("inventoryTransfer.unknownStorage", "Unknown storage")}{" "}
                            • {formatDateTime(adjustment.createdAt)}
                          </div>
                          <div className="flex flex-wrap gap-2 text-sm">
                            <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                              {t("stockAdjustments.history.qty", "Qty {{value}}", { value: formatNumericInput(String(adjustment.quantity)) })}
                            </span>
                            <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                              {t("stockAdjustments.history.previousToNew", "{{previous}} → {{new}}", { previous: String(adjustment.previousQuantity), new: String(adjustment.newQuantity) })}
                            </span>
                          </div>
                        </div>
                        <div className="max-w-md text-sm text-muted-foreground">
                          {adjustment.notes || t("stockAdjustments.history.noNotes", "No notes provided.")}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                {t("stockAdjustments.recentTransactions.title", "Recent inventory transactions")}
              </CardTitle>
              <CardDescription>
                {t("stockAdjustments.recentTransactions.description", "Unified audit trail for initial stock, adjustments, and transfers.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentTransactions.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("stockAdjustments.recentTransactions.empty", "No inventory transactions are available yet.")}
                </div>
              ) : (
                recentTransactions.map((transaction) => {
                  const isPositive = transaction.quantityDelta > 0;
                  return (
                    <div
                      key={transaction.id}
                      className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-background/70 p-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {productsById.get(transaction.productId)?.name ||
                              t("inventoryTransfer.transactions.unknownProduct", "Unknown product")}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              isPositive
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                                : "border-rose-500/20 bg-rose-500/10 text-rose-700",
                            )}
                          >
                            {mapTransactionLabel(transaction, t)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {storagesById.get(transaction.storageId)?.name ||
                            t("inventoryTransfer.unknownStorage", "Unknown storage")}{" "}
                          • {formatDateTime(transaction.createdAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-sm">
                        <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                          {t("stockAdjustments.recentTransactions.delta", "Delta {{sign}}{{value}}", { sign: isPositive ? "+" : "", value: formatNumericInput(String(transaction.quantityDelta)) })}
                        </span>
                        <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                          {transaction.previousQuantity} →{" "}
                          {transaction.newQuantity}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canManageStockBatches && (
        <TabsContent value="batches" className="space-y-6">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle>{t("stockAdjustments.batches.title", "Batch tracking")}</CardTitle>
              <CardDescription>
                {t("stockAdjustments.batches.description", "Grouped by product and storage with a coverage check against current inventory.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {batchGroups.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("stockAdjustments.batches.empty", "No stock batches have been created yet.")}
                </div>
              ) : (
                batchGroups.map((group) => {
                  const inventoryQuantity =
                    inventoryByKey.get(
                      groupKey(group.productId, group.storageId),
                    ) || 0;
                  const mismatch = inventoryQuantity !== group.batchQuantity;
                  return (
                    <div
                      key={groupKey(group.productId, group.storageId)}
                      className="rounded-3xl border border-border/60 bg-background/80 p-5"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-black">
                              {productsById.get(group.productId)?.name ||
                                t("inventoryTransfer.transactions.unknownProduct", "Unknown product")}
                            </span>
                            <span className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                              {storagesById.get(group.storageId)?.name ||
                                t("inventoryTransfer.unknownStorage", "Unknown storage")}
                            </span>
                            {mismatch && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {t("stockAdjustments.batches.coverageMismatch", "Coverage mismatch")}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 text-sm">
                            <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                              {t("stockAdjustments.batches.inventory", "Inventory {{value}}", { value: formatNumericInput(String(inventoryQuantity)) })}
                            </span>
                            <span className="rounded-full border border-border/60 px-3 py-1 font-semibold">
                              {t("stockAdjustments.batches.batchCount", "Batches {{value}}", { value: String(group.batchQuantity) })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {group.rows.map((batch) => {
                          const expiryBadge = getExpiryBadge(batch.expiryDate, t);
                          const productDefaults = productsById.get(
                            batch.productId,
                          );
                          const hasCustomPricing =
                            !!productDefaults &&
                            (batch.price !== productDefaults.price ||
                              batch.costPrice !== productDefaults.costPrice ||
                              batch.currency !== productDefaults.currency);
                          return (
                            <div
                              key={batch.id}
                              className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">
                                    {batch.batchNumber}
                                  </span>
                                  <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs font-semibold">
                                    {t("stockAdjustments.batches.qty", "Qty {{value}}", { value: formatNumericInput(String(batch.quantity)) })}
                                  </span>
                                  {expiryBadge && (
                                    <span
                                      className={cn(
                                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                                        expiryBadge.className,
                                      )}
                                    >
                                      {expiryBadge.label}
                                    </span>
                                  )}
                                  {hasCustomPricing && (
                                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-700">
                                      {t("stockAdjustments.batches.customPricing", "Custom pricing")}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2 text-sm">
                                  <span className="rounded-full border border-border/60 bg-background px-2.5 py-1 font-semibold">
                                    {t("stockAdjustments.batches.sell", "Sell {{amount}}", { amount: formatCurrency(batch.price, batch.currency) })}
                                  </span>
                                  <span className="rounded-full border border-border/60 bg-background px-2.5 py-1 font-semibold">
                                    {t("stockAdjustments.batches.cost", "Cost {{amount}}", { amount: formatCurrency(batch.costPrice, batch.currency) })}
                                  </span>
                                  <span className="rounded-full border border-border/60 bg-background px-2.5 py-1 font-semibold uppercase text-muted-foreground">
                                    {batch.currency}
                                  </span>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {batch.manufacturingDate
                                    ? t("stockAdjustments.batches.manufactured", "Manufactured {{date}}", { date: formatDate(batch.manufacturingDate) })
                                    : t("stockAdjustments.batches.noManufacturingDate", "No manufacturing date")}
                                  {batch.expiryDate
                                    ? ` • ${t("stockAdjustments.batches.expires", "Expires {{date}}", { date: formatDate(batch.expiryDate) })}`
                                    : ` • ${t("stockAdjustments.batches.noExpiryDate", "No expiry date")}`}
                                </div>
                                {batch.notes && (
                                  <div className="text-sm text-muted-foreground">
                                    {batch.notes}
                                  </div>
                                )}
                              </div>
                              {canEdit && (
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    className="gap-2 rounded-xl"
                                    onClick={() => {
                                      setBatchForm({
                                        id: batch.id,
                                        productId: batch.productId,
                                        storageId: batch.storageId,
                                        batchNumber: batch.batchNumber,
                                        quantity: String(batch.quantity),
                                        price: String(
                                          batch.price ??
                                            productDefaults?.price ??
                                            0,
                                        ),
                                        costPrice: String(
                                          batch.costPrice ??
                                            productDefaults?.costPrice ??
                                            0,
                                        ),
                                        currency:
                                          batch.currency ??
                                          productDefaults?.currency ??
                                          "usd",
                                        expiryDate: batch.expiryDate || "",
                                        manufacturingDate:
                                          batch.manufacturingDate || "",
                                        notes: batch.notes || "",
                                      });
                                      setBatchDialogOpen(true);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    {t("stockAdjustments.batches.edit", "Edit")}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="gap-2 rounded-xl text-rose-700"
                                    onClick={() => setBatchToDelete(batch)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t("stockAdjustments.batches.delete", "Delete")}
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      <Dialog
        open={adjustmentDialogOpen}
        onOpenChange={(open) => {
          setAdjustmentDialogOpen(open);
          if (!open) resetAdjustmentForm();
        }}
      >
        <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-3xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)] sm:rounded-[1.75rem]">
          <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-start sm:px-6 sm:py-5">
            <DialogTitle>{t("stockAdjustments.dialog.adjustment.title", "New Stock Adjustment")}</DialogTitle>
            <DialogDescription>
              {t("stockAdjustments.dialog.adjustment.description", "Pick the product and storage, then set the final stock quantity you want to keep there.")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleAdjustmentSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label htmlFor="adjustment-search">{t("stockAdjustments.dialog.adjustment.productSearch", "Product search")}</Label>
                    <ProductAutocompleteInput
                      value={adjustmentSearch}
                      onChange={(value) => {
                        setAdjustmentSearch(value);
                        setAdjustmentForm((current) => ({ ...current, productId: "" }));
                      }}
                      onSelectProduct={(product) => {
                        setAdjustmentForm((current) => ({ ...current, productId: product.id }));
                        setAdjustmentSearch(product.name);
                      }}
                      products={products}
                      placeholder={t("stockAdjustments.dialog.adjustment.productSearchPlaceholder", "Search products by name or SKU")}
                      hasSelection={!!adjustmentForm.productId}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("stockAdjustments.dialog.adjustment.storage", "Storage")}</Label>
                    <Select
                      value={adjustmentForm.storageId}
                      onValueChange={(value) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          storageId: value,
                        }))
                      }
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder={t("stockAdjustments.dialog.adjustment.selectStorage", "Select storage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {adjustmentStorageOptions.map((storage) => (
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
                      {adjustmentAvailableQuantity !== null ? (
                        <span className="text-xs text-muted-foreground">
                          {t("stockAdjustments.dialog.adjustment.currentAvailable", "Current available {{value}}", { value: formatNumericInput(String(adjustmentAvailableQuantity)) })}
                        </span>
                      ) : null}
                    </div>
                    <div className="relative">
                      <Input
                        id="adjustment-quantity"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        disabled={!adjustmentSelectionKey}
                        value={formatNumericInput(adjustmentForm.quantity)}
                        onChange={(event) =>
                          setAdjustmentForm((current) => ({
                            ...current,
                            quantity: sanitizeNumericInput(event.target.value, {
                              allowDecimal: false,
                            }),
                          }))
                        }
                        className={cn(
                          "pr-20",
                          adjustmentDeltaMeta?.inputClassName,
                        )}
                      />
                      {adjustmentDeltaMeta ? (
                        <span
                          className={cn(
                            "pointer-events-none absolute inset-y-0 right-3 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                            adjustmentDeltaMeta.badgeClassName,
                          )}
                        >
                          {isAdjustmentIncrease ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )}
                          {adjustmentDeltaMeta.badge}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "text-xs",
                        adjustmentDeltaMeta?.textClassName ||
                          "text-muted-foreground",
                      )}
                    >
                      {!adjustmentSelectionKey
                        ? t("stockAdjustments.dialog.adjustment.selectPrompt", "Select a product and storage to load the current quantity.")
                        : adjustmentTargetQuantity === null
                          ? t("stockAdjustments.dialog.adjustment.enterQuantity", "Enter the final quantity you want after this adjustment.")
                          : adjustmentQuantityDelta === 0
                            ? t("stockAdjustments.dialog.adjustment.noChange", "No change yet. Adjust the quantity above to create an entry.")
                            : adjustmentQuantityDelta &&
                                adjustmentQuantityDelta > 0
                              ? t("stockAdjustments.dialog.adjustment.increaseBy", "Increase by {{delta}}. {{available}} -> {{target}}.", { delta: formatNumericInput(String(adjustmentQuantityDelta)), available: formatNumericInput(String(adjustmentAvailableQuantity ?? 0)), target: formatNumericInput(String(adjustmentTargetQuantity)) })
                              : t("stockAdjustments.dialog.adjustment.decreaseBy", "Decrease by {{delta}}. {{available}} -> {{target}}.", { delta: formatNumericInput(String(Math.abs(adjustmentQuantityDelta ?? 0))), available: formatNumericInput(String(adjustmentAvailableQuantity ?? 0)), target: formatNumericInput(String(adjustmentTargetQuantity ?? 0)) })}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("stockAdjustments.dialog.adjustment.reason", "Reason")}</Label>
                    <Select
                      value={adjustmentForm.reason}
                      onValueChange={(value) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          reason: value as StockAdjustmentReason,
                        }))
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
                    value={adjustmentForm.notes}
                    onChange={(event) =>
                      setAdjustmentForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
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
                onClick={() => setAdjustmentDialogOpen(false)}
                disabled={isSavingAdjustment}
              >
                {t("stockAdjustments.dialog.adjustment.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={!canSaveAdjustment || isSavingAdjustment}
              >
                {isSavingAdjustment
                  ? t("stockAdjustments.dialog.adjustment.saving", "Saving...")
                  : t("stockAdjustments.dialog.adjustment.save", "Save Adjustment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchDialogOpen}
        onOpenChange={(open) => {
          setBatchDialogOpen(open);
          if (!open) resetBatchForm();
        }}
      >
        <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-3xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)] sm:rounded-[1.75rem]">
          <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-start sm:px-6 sm:py-5">
            <DialogTitle>
              {batchForm.id ? t("stockAdjustments.dialog.batch.titleEdit", "Edit Stock Batch") : t("stockAdjustments.dialog.batch.titleNew", "New Stock Batch")}
            </DialogTitle>
            <DialogDescription>
              {t("stockAdjustments.dialog.batch.description", "Track the batch quantity, dates, and pricing snapshot for one storage. Product pricing is loaded by default and can be overridden for this batch.")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleBatchSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="batch-search">{t("stockAdjustments.dialog.batch.productSearch", "Product search")}</Label>
                  <Input
                    id="batch-search"
                    value={batchSearch}
                    onChange={(event) => setBatchSearch(event.target.value)}
                    placeholder={t("stockAdjustments.dialog.batch.productSearchPlaceholder", "Search products by name or SKU")}
                    className="rounded-xl"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("stockAdjustments.dialog.batch.product", "Product")} <span className="text-destructive">*</span></Label>
                    <Select
                      value={batchForm.productId}
                      onValueChange={(value) =>
                        setBatchForm((current) => {
                          const product = productsById.get(value);
                          return {
                            ...current,
                            productId: value,
                            price: product ? String(product.price ?? 0) : "",
                            costPrice: product
                              ? String(product.costPrice ?? 0)
                              : "",
                            currency: product?.currency ?? "usd",
                          };
                        })
                      }
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder={t("stockAdjustments.dialog.batch.selectProduct", "Select product")} />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredProductsForBatch.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} • {product.sku}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("stockAdjustments.dialog.batch.storage", "Storage")} <span className="text-destructive">*</span></Label>
                    <Select
                      value={batchForm.storageId}
                      onValueChange={(value) =>
                        setBatchForm((current) => ({
                          ...current,
                          storageId: value,
                        }))
                      }
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder={t("stockAdjustments.dialog.batch.selectStorage", "Select storage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {batchStorageOptions.map((storage) => (
                          <SelectItem key={storage.id} value={storage.id}>
                            {storage.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="batch-number">{t("stockAdjustments.dialog.batch.batchNumber", "Batch / Lot Number")} <span className="text-destructive">*</span></Label>
                    <Input
                      id="batch-number"
                      value={batchForm.batchNumber}
                      onChange={(event) =>
                        setBatchForm((current) => ({
                          ...current,
                          batchNumber: event.target.value,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="batch-quantity">{t("stockAdjustments.dialog.batch.quantity", "Quantity")} <span className="text-destructive">*</span></Label>
                      {batchInventoryQuantity !== null ? (
                        <span className="text-xs text-muted-foreground">
                          {t("stockAdjustments.dialog.batch.inventoryAvailable", "Inventory available {{value}}", { value: formatNumericInput(String(batchInventoryQuantity)) })}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      id="batch-quantity"
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatNumericInput(batchForm.quantity)}
                      onChange={(event) =>
                        setBatchForm((current) => ({
                          ...current,
                          quantity: sanitizeNumericInput(event.target.value, {
                            allowDecimal: false,
                          }),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="batch-price">{t("stockAdjustments.dialog.batch.batchPrice", "Batch price")} <span className="text-destructive">*</span></Label>
                    <Input
                      id="batch-price"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={formatNumericInput(batchForm.price)}
                      onChange={(event) =>
                        setBatchForm((current) => ({
                          ...current,
                          price: sanitizeNumericInput(event.target.value),
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="batch-cost-price">{t("stockAdjustments.dialog.batch.batchCost", "Batch cost")} <span className="text-destructive">*</span></Label>
                    <Input
                      id="batch-cost-price"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={formatNumericInput(batchForm.costPrice)}
                      onChange={(event) =>
                        setBatchForm((current) => ({
                          ...current,
                          costPrice: sanitizeNumericInput(event.target.value),
                        }))
                      }
                    />
                  </div>
                  <CurrencySelector
                    label={t("stockAdjustments.dialog.batch.currency", "Currency")}
                    value={batchForm.currency}
                    onChange={(value) =>
                      setBatchForm((current) => ({
                        ...current,
                        currency: value,
                      }))
                    }
                  />
                </div>
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  {selectedBatchProduct ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {t("stockAdjustments.batches.productDefault", "Product default:")}
                        {" "}
                        {formatCurrency(
                          selectedBatchProduct.price,
                          selectedBatchProduct.currency,
                        )}
                      </span>
                      <span>
                        {t("stockAdjustments.batches.cost", "Cost {{amount}}", { amount: formatCurrency(selectedBatchProduct.costPrice, selectedBatchProduct.currency) })}
                      </span>
                      <span className="uppercase">
                        {selectedBatchProduct.currency}
                      </span>
                      {batchUsesCustomPricing ? (
                        <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-700">
                          {t("stockAdjustments.batches.batchOverride", "Batch override active")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {t("stockAdjustments.batches.usingDefaults", "Using product defaults")}
                        </span>
                      )}
                    </div>
                  ) : (
                    t("stockAdjustments.batches.loadProductMsg", "Select a product to load its default price, cost, and currency.")
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("stockAdjustments.dialog.batch.expiryDate", "Expiry date")}</Label>
                    <DateTimePicker
                      mode="date"
                      date={parseLocalDateValue(batchForm.expiryDate)}
                      setDate={(value) =>
                        setBatchForm((current) => ({
                          ...current,
                          expiryDate: formatLocalDateValue(value),
                        }))
                      }
                      placeholder={t("stockAdjustments.dialog.batch.expiryDatePlaceholder", "Optional expiry date")}
                      buttonClassName="rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("stockAdjustments.dialog.batch.manufacturingDate", "Manufacturing date")}</Label>
                    <DateTimePicker
                      mode="date"
                      date={parseLocalDateValue(batchForm.manufacturingDate)}
                      setDate={(value) =>
                        setBatchForm((current) => ({
                          ...current,
                          manufacturingDate: formatLocalDateValue(value),
                        }))
                      }
                      placeholder={t("stockAdjustments.dialog.batch.manufacturingDatePlaceholder", "Optional manufacturing date")}
                      buttonClassName="rounded-xl"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="batch-notes">{t("stockAdjustments.dialog.batch.notes", "Notes")}</Label>
                  <Textarea
                    id="batch-notes"
                    value={batchForm.notes}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
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
                onClick={() => setBatchDialogOpen(false)}
                disabled={isSavingBatch}
              >
                {t("stockAdjustments.dialog.batch.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={!canSaveBatch || isSavingBatch}
              >
                {isSavingBatch
                  ? t("stockAdjustments.dialog.batch.saving", "Saving...")
                  : batchForm.id
                    ? t("stockAdjustments.dialog.batch.saveChanges", "Save Changes")
                    : t("stockAdjustments.dialog.batch.saveBatch", "Save Batch")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={!!batchToDelete}
        onClose={() => {
          if (!isDeletingBatch) setBatchToDelete(null);
        }}
        onConfirm={() => {
          void handleDeleteBatch();
        }}
        isLoading={isDeletingBatch}
        title={t("stockAdjustments.deleteConfirm.title", "Delete stock batch?")}
        description={t("stockAdjustments.deleteConfirm.description", "This will soft-delete the batch from active tracking.")}
        itemName={batchToDelete?.batchNumber || ""}
      />
    </div>
  );
}

export default StockAdjustments;
