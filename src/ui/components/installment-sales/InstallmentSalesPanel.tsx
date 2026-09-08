import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeDollarSign,
  CalendarDays,
  CircleX,
  ListChecks,
  Loader2,
  PackageOpen,
  Plus,
  Printer,
  ReceiptText,
  Search,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "@/auth";
import { useDateRange } from "@/context/DateRangeContext";
import { isDateInDateRange } from "@/lib/dateRangeFilters";
import {
  formatCurrency,
  formatLocalDateValue,
  formatDate,
  formatNumericInput,
  parseFormattedNumber,
  sanitizeNumericInput,
} from "@/lib/utils";
import { generateTemplatePdf, type PrintFormat } from "@/services/pdfGenerator";
import {
  cancelInstallmentSale,
  createInstallmentSale,
  recordInstallmentSaleCustomerPayment,
  useInstallmentSaleInstallments,
  useInstallmentSalePayments,
  useInstallmentSales,
  type BusinessPartner,
  type CurrencyCode,
  type InstallmentSale,
  type InstallmentSaleFrequency,
  type InstallmentSaleInstallment,
  type PaymentAccount,
  type WorkspacePaymentMethod,
} from "@/local-db";
import { useWorkspace } from "@/workspace";
import { PartnerAutocompleteInput } from "@/ui/components/crm/PartnerAutocompleteInput";
import { QuickCustomerButton } from "@/ui/components/crm/QuickCustomerButton";
import { DateRangeFilters } from "@/ui/components/DateRangeFilters";
import { PaymentAccountSelector } from "@/ui/components/payments/PaymentAccountSelector";
import { PaymentMethodSelector } from "@/ui/components/PaymentMethodSelector";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CurrencySelector,
  DateTimePicker,
  Input,
  Label,
  PrintPreviewModal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from "@/ui/components";
import { InstallmentSalePrintTemplate } from "./InstallmentSalePrintTemplate";

type SaleFilter = "all" | "active" | "overdue" | "completed";

function groupSaleAmounts(
  sales: InstallmentSale[],
  selectAmount: (sale: InstallmentSale) => number,
) {
  const amounts = new Map<CurrencyCode, number>();
  for (const sale of sales) {
    amounts.set(
      sale.currency,
      (amounts.get(sale.currency) || 0) + selectAmount(sale),
    );
  }
  return [...amounts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function statusTone(status: InstallmentSale["status"]) {
  if (status === "overdue") return "destructive";
  if (status === "completed") return "secondary";
  if (status === "cancelled") return "outline";
  return "default";
}

function LinkPill({
  partner,
  onUnlink,
  label,
}: {
  partner: BusinessPartner | null;
  onUnlink: () => void;
  label: string;
}) {
  if (!partner) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Badge variant="secondary" className="shrink-0">
          {label}
        </Badge>
        <span className="truncate font-medium">{partner.partnerName}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2"
        onClick={onUnlink}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CreateInstallmentSaleDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { features } = useWorkspace();
  const [isSaving, setIsSaving] = useState(false);
  const [customer, setCustomer] = useState<BusinessPartner | null>(null);
  const [customerText, setCustomerText] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(
    features.default_currency,
  );
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [showPricing, setShowPricing] = useState(false);
  const [hasDownPayment, setHasDownPayment] = useState(false);
  const [downPayment, setDownPayment] = useState("");
  const [downMethod, setDownMethod] = useState<WorkspacePaymentMethod>("cash");
  const [downAccount, setDownAccount] = useState<PaymentAccount | null>(null);
  const [count, setCount] = useState("1");
  const [frequency, setFrequency] = useState<InstallmentSaleFrequency>("monthly");
  const [firstDueDate, setFirstDueDate] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setIsSaving(false);
    setCustomer(null);
    setCustomerText("");
    setDescription("");
    setNotes("");
    setCurrency(features.default_currency);
    setCost("");
    setPrice("");
    setShowPricing(false);
    setHasDownPayment(false);
    setDownPayment("");
    setDownMethod("cash");
    setDownAccount(null);
    setCount("1");
    setFrequency("monthly");
    setFirstDueDate(undefined);
  }, [features.default_currency, open]);

  const numericCost = parseFormattedNumber(cost || "0");
  const numericPrice = parseFormattedNumber(price || "0");
  const numericDown = hasDownPayment
    ? parseFormattedNumber(downPayment || "0")
    : 0;
  const profit = numericPrice - numericCost;
  const isNoFrequency = frequency === "no_frequency";
  const canSubmit =
    !!customer &&
    description.trim().length > 0 &&
    numericCost > 0 &&
    numericPrice >= numericCost &&
    numericDown >= 0 &&
    numericDown < numericPrice &&
    (isNoFrequency || (Number(count) > 0 && !!firstDueDate));
  const numericInput = (value: string) =>
    sanitizeNumericInput(value, { allowDecimal: currency !== "iqd" });

  const handleOpenChange = (next: boolean) => {
    if (!isSaving) onOpenChange(next);
  };
  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || isSaving || !customer) return;
    setIsSaving(true);
    try {
      await createInstallmentSale(workspaceId, {
        customerBusinessPartnerId: customer.id,
        description,
        notes,
        currency,
        acquisitionCost: numericCost,
        totalSalePrice: numericPrice,
        downPaymentAmount: numericDown,
        installmentCount: isNoFrequency ? 1 : Number(count),
        installmentFrequency: frequency,
        firstDueDate: isNoFrequency ? null : formatLocalDateValue(firstDueDate),
        downPaymentMethod: downMethod,
        downPaymentAccountId: downAccount?.id ?? null,
        downPaymentAccountNameSnapshot: downAccount?.name ?? null,
        createdBy: user?.id ?? null,
      });
      toast({
        title: t("messages.success"),
        description: t("installmentSales.messages.created"),
      });
      onOpenChange(false);
    } catch {
      toast({
        variant: "destructive",
        title: t("messages.error"),
        description: t("installmentSales.messages.createFailed"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppDialog open={open} onOpenChange={handleOpenChange}>
      <AppDialogContent
        className="max-w-5xl"
        showCloseButton={!isSaving}
        onPointerDownOutside={(event) => isSaving && event.preventDefault()}
        onInteractOutside={(event) => isSaving && event.preventDefault()}
        onEscapeKeyDown={(event) => isSaving && event.preventDefault()}
      >
        <AppDialogHeader>
          <AppDialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            {t("installmentSales.createTitle")}
          </AppDialogTitle>
        </AppDialogHeader>
        <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
          <AppDialogBody className="space-y-6">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>
                  {t("installmentSales.customer")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <PartnerAutocompleteInput
                    value={customerText}
                    onChange={setCustomerText}
                    onSelectPartner={(partner) => {
                      setCustomer(partner);
                      setCustomerText(partner.partnerName);
                      if (!price && partner.defaultCurrency)
                        setCurrency(partner.defaultCurrency);
                    }}
                    workspaceId={workspaceId}
                    roles={["customer", "both"]}
                    disabled={isSaving || !!customer}
                  />
                  <QuickCustomerButton
                    workspaceId={workspaceId}
                    className="w-full shrink-0 sm:w-auto"
                    disabled={isSaving || !!customer}
                    onCreated={(partner) => {
                      setCustomer(partner);
                      setCustomerText(partner.partnerName);
                      if (!price && partner.defaultCurrency)
                        setCurrency(partner.defaultCurrency);
                    }}
                  />
                </div>
                <LinkPill
                  partner={customer}
                  label={t("common.linked")}
                  onUnlink={() => {
                    setCustomer(null);
                    setCustomerText("");
                  }}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>
                {t("installmentSales.description")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSaving}
                rows={3}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <CurrencySelector
                value={currency}
                onChange={setCurrency}
                label={`${t("installmentSales.currency")} *`}
                allowedCurrencies={features.allowed_currencies}
                iqdDisplayPreference={features.iqd_display_preference}
              />
              <div className="grid gap-2">
                <Label>
                  {t("installmentSales.acquisitionCost")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  inputMode={currency === "iqd" ? "numeric" : "decimal"}
                  placeholder="0"
                  value={formatNumericInput(cost)}
                  onChange={(event) =>
                    setCost(numericInput(event.target.value))
                  }
                  disabled={isSaving}
                />
              </div>
              <div className="grid gap-2">
                <Label>
                  {t("installmentSales.totalSalePrice")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  inputMode={currency === "iqd" ? "numeric" : "decimal"}
                  placeholder="0"
                  value={formatNumericInput(price)}
                  onChange={(event) =>
                    setPrice(numericInput(event.target.value))
                  }
                  disabled={isSaving}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setShowPricing((value) => !value)}
              disabled={isSaving}
            >
              <TrendingUp className="h-4 w-4" />
              {t("installmentSales.pricingBreakdown")}
            </Button>
            {showPricing ? (
              <div className="grid gap-3 rounded-2xl border border-dashed bg-muted/20 p-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("installmentSales.acquisitionCost")}
                  </div>
                  <strong>
                    {formatCurrency(
                      numericCost,
                      currency,
                      features.iqd_display_preference,
                    )}
                  </strong>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("installmentSales.totalSalePrice")}
                  </div>
                  <strong>
                    {formatCurrency(
                      numericPrice,
                      currency,
                      features.iqd_display_preference,
                    )}
                  </strong>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("installmentSales.grossProfit")}
                  </div>
                  <strong
                    className={
                      profit < 0 ? "text-destructive" : "text-emerald-600"
                    }
                  >
                    {formatCurrency(
                      profit,
                      currency,
                      features.iqd_display_preference,
                    )}
                  </strong>
                </div>
              </div>
            ) : null}
            <div className="rounded-2xl border p-4 space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={hasDownPayment}
                  onChange={(event) => setHasDownPayment(event.target.checked)}
                  disabled={isSaving}
                />
                {t("installmentSales.recordDownPayment")}
              </label>
              {hasDownPayment ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="grid gap-2">
                    <Label>
                      {t("installmentSales.downPayment")}{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="text"
                      inputMode={currency === "iqd" ? "numeric" : "decimal"}
                      placeholder="0"
                      value={formatNumericInput(downPayment)}
                      onChange={(event) =>
                        setDownPayment(numericInput(event.target.value))
                      }
                      disabled={isSaving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>
                      {t("payments.table.method")}{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <PaymentMethodSelector
                      value={downMethod}
                      onValueChange={(value) =>
                        setDownMethod(value as WorkspacePaymentMethod)
                      }
                      onLinkedPaymentAccountSelect={setDownAccount}
                      workspaceId={workspaceId}
                    />
                  </div>
                  <PaymentAccountSelector
                    workspaceId={workspaceId}
                    value={downAccount?.id ?? null}
                    onValueChange={setDownAccount}
                    disabled={isSaving}
                    cashDrawerOnly={downMethod === "cash"}
                  />
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {!isNoFrequency ? <div className="grid gap-2">
                <Label>
                  {t("installmentSales.installmentCount")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={count}
                  onChange={(event) =>
                    setCount(event.target.value.replace(/\D/g, ""))
                  }
                  disabled={isSaving}
                />
              </div> : null}
              <div className="grid gap-2">
                <Label>
                  {t("installmentSales.frequency")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={frequency}
                  onValueChange={(value) => {
                    const nextFrequency = value as InstallmentSaleFrequency;
                    setFrequency(nextFrequency);
                    if (nextFrequency === "no_frequency") {
                      setFirstDueDate(undefined);
                    }
                  }}
                  disabled={isSaving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_frequency">
                      {t("installmentSales.noFrequency")}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t("loans.frequencies.daily")}
                    </SelectItem>
                    <SelectItem value="weekly">
                      {t("loans.frequencies.weekly")}
                    </SelectItem>
                    <SelectItem value="biweekly">
                      {t("loans.frequencies.biweekly")}
                    </SelectItem>
                    <SelectItem value="monthly">
                      {t("loans.frequencies.monthly")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isNoFrequency ? (
                  <p className="text-xs text-muted-foreground">
                    {t("installmentSales.noFrequencyHint")}
                  </p>
                ) : null}
              </div>
              {!isNoFrequency ? <div className="grid gap-2">
                <Label>
                  {t("installmentSales.firstDueDate")}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <DateTimePicker
                  date={firstDueDate}
                  setDate={setFirstDueDate}
                  mode="date"
                  disabled={isSaving}
                  placeholder={t("installmentSales.firstDueDate")}
                />
              </div> : null}
            </div>
            <div className="grid gap-2">
              <Label>{t("common.notes")}</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isSaving}
                rows={2}
              />
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("installmentSales.confirmSale")}
            </Button>
          </AppDialogFooter>
        </form>
      </AppDialogContent>
    </AppDialog>
  );
}

function RecordSalePaymentDialog({
  open,
  onOpenChange,
  sale,
  installment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: InstallmentSale | null;
  installment?: InstallmentSaleInstallment | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { features } = useWorkspace();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WorkspacePaymentMethod>("cash");
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isSaving, setIsSaving] = useState(false);
  const maximum =
    installment?.balanceAmount ?? sale?.customerBalanceAmount ?? 0;
  useEffect(() => {
    if (open && sale) {
      setAmount(String(maximum));
      setMethod("cash");
      setAccount(null);
      setNote("");
      setDate(new Date());
      setIsSaving(false);
    }
  }, [maximum, open, sale]);
  const numericAmount = parseFormattedNumber(amount || "0");
  const canSubmit = !!sale && numericAmount > 0 && numericAmount <= maximum;
  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sale || !canSubmit || isSaving) return;
    setIsSaving(true);
    try {
      const input = {
        installmentSaleId: sale.id,
        amount: numericAmount,
        paymentMethod: method,
        paidAt: date?.toISOString(),
        note,
        createdBy: user?.id ?? null,
        accountId: account?.id ?? null,
        accountNameSnapshot: account?.name ?? null,
      };
      await recordInstallmentSaleCustomerPayment(sale.workspaceId, {
        ...input,
        installmentId: installment?.id ?? null,
      });
      toast({
        title: t("messages.success"),
        description: t("installmentSales.messages.paymentRecorded"),
      });
      onOpenChange(false);
    } catch {
      toast({
        variant: "destructive",
        title: t("messages.error"),
        description: t("installmentSales.messages.paymentFailed"),
      });
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => !isSaving && onOpenChange(next)}
    >
      <AppDialogContent
        className="max-w-xl"
        showCloseButton={!isSaving}
        onPointerDownOutside={(event) => isSaving && event.preventDefault()}
        onInteractOutside={(event) => isSaving && event.preventDefault()}
        onEscapeKeyDown={(event) => isSaving && event.preventDefault()}
      >
        <AppDialogHeader>
          <AppDialogTitle className="flex gap-2">
            <BadgeDollarSign className="h-5 w-5" />
            {t("installmentSales.collectCustomer")}
          </AppDialogTitle>
        </AppDialogHeader>
        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <AppDialogBody className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                {t("installmentSales.paymentBalance")}
              </div>
              <strong>
                {sale
                  ? formatCurrency(
                      maximum,
                      sale.currency,
                      features.iqd_display_preference,
                    )
                  : "-"}
              </strong>
            </div>
            <div className="grid gap-2">
              <Label>
                {t("payments.table.amount")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                type="text"
                inputMode={sale?.currency === "iqd" ? "numeric" : "decimal"}
                placeholder="0"
                value={formatNumericInput(amount)}
                onChange={(event) =>
                  setAmount(
                    sanitizeNumericInput(event.target.value, {
                      allowDecimal: sale?.currency !== "iqd",
                    }),
                  )
                }
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-2">
              <Label>
                {t("payments.table.method")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <PaymentMethodSelector
                value={method}
                onValueChange={(value) =>
                  setMethod(value as WorkspacePaymentMethod)
                }
                onLinkedPaymentAccountSelect={setAccount}
                workspaceId={sale?.workspaceId}
              />
            </div>
            <PaymentAccountSelector
              workspaceId={sale?.workspaceId}
              value={account?.id ?? null}
              onValueChange={setAccount}
              disabled={isSaving}
              cashDrawerOnly={method === "cash"}
            />
            <div className="grid gap-2">
              <Label>
                {t("installmentSales.paymentDate")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <DateTimePicker
                date={date}
                setDate={setDate}
                mode="date-time"
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("common.notes")}</Label>
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ReceiptText className="h-4 w-4" />
              )}
              {t("common.record")}
            </Button>
          </AppDialogFooter>
        </form>
      </AppDialogContent>
    </AppDialog>
  );
}

function CancelSaleDialog({
  sale,
  open,
  onOpenChange,
}: {
  sale: InstallmentSale | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setIsSaving(false);
    }
  }, [open]);
  const canSubmit = !!sale && !!reason.trim();
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sale || !canSubmit || isSaving) return;
    setIsSaving(true);
    try {
      await cancelInstallmentSale(sale.workspaceId, sale.id, {
        reason,
        cancelledBy: user?.id ?? null,
      });
      toast({
        title: t("messages.success"),
        description: t("installmentSales.messages.cancelled"),
      });
      onOpenChange(false);
    } catch {
      toast({
        variant: "destructive",
        title: t("messages.error"),
        description: t("installmentSales.messages.cancelFailed"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => !isSaving && onOpenChange(next)}
    >
      <AppDialogContent
        className="max-w-lg"
        showCloseButton={!isSaving}
        onPointerDownOutside={(event) => isSaving && event.preventDefault()}
        onInteractOutside={(event) => isSaving && event.preventDefault()}
        onEscapeKeyDown={(event) => isSaving && event.preventDefault()}
      >
        <AppDialogHeader>
          <AppDialogTitle className="flex items-center gap-2">
            <CircleX className="h-5 w-5 text-destructive" />
            {t("installmentSales.cancelTitle")}
          </AppDialogTitle>
        </AppDialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <AppDialogBody className="space-y-4">
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
              {t("installmentSales.cancellationWarning")}
            </p>
            <div className="grid gap-2">
              <Label>
                {t("installmentSales.cancellationReason")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CircleX className="h-4 w-4" />
              )}
              {t("installmentSales.confirmCancellation")}
            </Button>
          </AppDialogFooter>
        </form>
      </AppDialogContent>
    </AppDialog>
  );
}

function SaleDetailsDialog({
  sale,
  onOpenChange,
}: {
  sale: InstallmentSale | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { features, workspaceName } = useWorkspace();
  const { user } = useAuth();
  const [customerPayment, setCustomerPayment] =
    useState<InstallmentSaleInstallment | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const installments = useInstallmentSaleInstallments(sale?.id);
  const customerPayments = useInstallmentSalePayments(sale?.id);
  const isNoFrequency = sale?.installmentFrequency === "no_frequency";
  const readOnly = user?.role === "viewer";
  return (
    <>
      <AppDialog open={!!sale} onOpenChange={onOpenChange}>
        <AppDialogContent className="max-w-6xl">
          <AppDialogHeader>
            <AppDialogTitle className="flex items-center gap-2">
              <ReceiptText className="h-5 w-5" />
              {sale?.saleNo}{" "}
              <Badge variant={sale ? statusTone(sale.status) : "outline"}>
                {sale ? t(`installmentSales.statuses.${sale.status}`) : ""}
              </Badge>
            </AppDialogTitle>
          </AppDialogHeader>
          <AppDialogBody className="space-y-6">
            {sale ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {t("installmentSales.customerReceivable")}
                      </div>
                      <strong>
                        {formatCurrency(
                          sale.customerBalanceAmount,
                          sale.currency,
                          features.iqd_display_preference,
                        )}
                      </strong>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {t("installmentSales.grossProfit")}
                      </div>
                      <strong>
                        {formatCurrency(
                          sale.grossProfit,
                          sale.currency,
                          features.iqd_display_preference,
                        )}
                      </strong>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">
                        {isNoFrequency
                          ? t("installmentSales.frequency")
                          : t("installmentSales.nextDueDate")}
                      </div>
                      <strong>
                        {isNoFrequency
                          ? t("installmentSales.noFrequency")
                          : sale.nextDueDate
                            ? formatDate(sale.nextDueDate)
                            : "-"}
                      </strong>
                    </CardContent>
                  </Card>
                </div>
                <div className="rounded-2xl border bg-muted/10 p-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <UserRound className="h-3.5 w-3.5" />
                      {t("installmentSales.customer")}
                    </div>
                    <strong>{sale.customerNameSnapshot}</strong>
                  </div>
                  <div className="mt-4">
                    <div className="text-xs text-muted-foreground">
                      {t("installmentSales.description")}
                    </div>
                    <div>{sale.description}</div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setPrintOpen(true)}>
                    <Printer className="h-4 w-4" />
                    {t("common.print")}
                  </Button>
                  {!readOnly && sale.customerBalanceAmount > 0 ? (
                    <Button
                      onClick={() =>
                        setCustomerPayment(
                          installments.find((row) => row.balanceAmount > 0) ||
                            null,
                        )
                      }
                    >
                      <BadgeDollarSign className="h-4 w-4" />
                      {t("installmentSales.collectCustomer")}
                    </Button>
                  ) : null}
                  {!readOnly && sale.status !== "cancelled" ? (
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setCancelOpen(true)}
                    >
                      <CircleX className="h-4 w-4" />
                      {t("installmentSales.cancelSale")}
                    </Button>
                  ) : null}
                </div>
                {!isNoFrequency ? <div className="rounded-xl border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("installmentSales.installment")}
                        </TableHead>
                        <TableHead>{t("installmentSales.dueDate")}</TableHead>
                        <TableHead className="text-end">
                          {t("installmentSales.planned")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("installmentSales.paid")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("installmentSales.balance")}
                        </TableHead>
                        <TableHead>{t("installmentSales.status")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {installments.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>#{row.installmentNo}</TableCell>
                          <TableCell>{row.dueDate ? formatDate(row.dueDate) : "-"}</TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(
                              row.plannedAmount,
                              sale.currency,
                              features.iqd_display_preference,
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(
                              row.paidAmount,
                              sale.currency,
                              features.iqd_display_preference,
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(
                              row.balanceAmount,
                              sale.currency,
                              features.iqd_display_preference,
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.status === "overdue"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {t(`loans.installmentStatuses.${row.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {!readOnly && row.balanceAmount > 0 ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setCustomerPayment(row)}
                              >
                                {t("common.record")}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div> : null}
                <div className="rounded-xl border p-4">
                  <div className="mb-3 font-semibold">
                    {t("installmentSales.customerPayments")}
                  </div>
                  {customerPayments.length ? (
                    customerPayments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex justify-between border-t py-2 text-sm"
                      >
                        <span>{formatDate(payment.paidAt)}</span>
                        <span>
                          {formatCurrency(
                            payment.amount,
                            sale.currency,
                            features.iqd_display_preference,
                          )}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t("common.noData")}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </AppDialogBody>
          <AppDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.close")}
            </Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>
      <RecordSalePaymentDialog
        open={customerPayment !== null}
        onOpenChange={(open) => !open && setCustomerPayment(null)}
        sale={sale}
        installment={customerPayment}
      />
      <CancelSaleDialog
        sale={sale}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
      />
      {sale ? (
        <PrintPreviewModal
          module="installment_sales"
          isOpen={printOpen}
          onClose={() => setPrintOpen(false)}
          onConfirm={() => setPrintOpen(false)}
          title={t("installmentSales.title")}
          features={features}
          workspaceName={workspaceName}
          originId={sale.id}
          showSaveButton={false}
          pdfBuilder={async ({
            format,
            effectiveId,
            printLangOverride,
          }: {
            format: PrintFormat;
            effectiveId: string;
            printLangOverride?: string;
          }) =>
            generateTemplatePdf({
              element: (
                <InstallmentSalePrintTemplate
                  workspaceName={workspaceName}
                  sale={sale}
                  installments={installments}
                  iqdPreference={features.iqd_display_preference}
                  qrValue={features.print_qr ? effectiveId : undefined}
                />
              ),
              format,
              printLang: printLangOverride,
            })
          }
          printTemplate={({ effectiveId }) => (
            <InstallmentSalePrintTemplate
              workspaceName={workspaceName}
              sale={sale}
              installments={installments}
              iqdPreference={features.iqd_display_preference}
              qrValue={features.print_qr ? effectiveId : undefined}
            />
          )}
          printSelectionOptions={[
            {
              format: "a4",
              nativeTemplateKey: "installment-sales.agreement",
              label: t("installmentSales.title"),
              description: t("installmentSales.subtitle"),
            },
          ]}
        />
      ) : null}
    </>
  );
}

export function InstallmentSalesPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { features } = useWorkspace();
  const { user } = useAuth();
  const { dateRange, customDates } = useDateRange();
  const sales = useInstallmentSales(workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState<InstallmentSale | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SaleFilter>("all");
  const scoped = useMemo(
    () =>
      sales.filter((sale) =>
        isDateInDateRange(sale.createdAt, dateRange, customDates),
      ),
    [customDates, dateRange, sales],
  );
  const visible = useMemo(
    () =>
      scoped.filter((sale) => {
        const query = search.trim().toLowerCase();
        return (
          (!query ||
            [sale.saleNo, sale.customerNameSnapshot, sale.description].some(
              (value) => value.toLowerCase().includes(query),
            )) &&
          (filter === "all" || sale.status === filter)
        );
      }),
    [filter, scoped, search],
  );
  const metrics = useMemo(
    () => ({
      receivable: groupSaleAmounts(
        scoped,
        (sale) => sale.customerBalanceAmount,
      ),
      overdue: scoped.filter((sale) => sale.status === "overdue").length,
      profit: groupSaleAmounts(scoped, (sale) => sale.grossProfit),
    }),
    [scoped],
  );
  const readOnly = user?.role === "viewer";
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <PackageOpen className="h-6 w-6 text-primary" />
            {t("installmentSales.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("installmentSales.subtitle")}
          </p>
        </div>
        {!readOnly ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("installmentSales.createSale")}
          </Button>
        ) : null}
      </div>
      <DateRangeFilters />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          title={t("installmentSales.customerReceivable")}
          value={
            <CurrencyMetricValue
              amounts={metrics.receivable}
              fallbackCurrency={features.default_currency}
              iqdPreference={features.iqd_display_preference}
            />
          }
          icon={<BadgeDollarSign className="h-4 w-4" />}
        />
        <Metric
          title={t("installmentSales.overdueSales")}
          value={String(metrics.overdue)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <Metric
          title={t("installmentSales.expectedGrossProfit")}
          value={
            <CurrencyMetricValue
              amounts={metrics.profit}
              fallbackCurrency={features.default_currency}
              iqdPreference={features.iqd_display_preference}
            />
          }
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {t("installmentSales.title")}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("installmentSales.search")}
              />
            </div>
            <Select
              value={filter}
              onValueChange={(value) => setFilter(value as SaleFilter)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="active">
                  {t("installmentSales.statuses.active")}
                </SelectItem>
                <SelectItem value="overdue">
                  {t("installmentSales.statuses.overdue")}
                </SelectItem>
                <SelectItem value="completed">
                  {t("installmentSales.statuses.completed")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("installmentSales.saleNo")}</TableHead>
                  <TableHead>{t("installmentSales.customer")}</TableHead>
                  <TableHead>{t("installmentSales.description")}</TableHead>
                  <TableHead className="text-end">
                    {t("installmentSales.customerReceivable")}
                  </TableHead>
                  <TableHead>{t("installmentSales.nextDueDate")}</TableHead>
                  <TableHead>{t("installmentSales.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length ? (
                  visible.map((sale) => (
                    <TableRow
                      key={sale.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedSale(sale)}
                    >
                      <TableCell className="font-medium">
                        {sale.saleNo}
                      </TableCell>
                      <TableCell>{sale.customerNameSnapshot}</TableCell>
                      <TableCell className="max-w-56 truncate">
                        {sale.description}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(
                          sale.customerBalanceAmount,
                          sale.currency,
                          features.iqd_display_preference,
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.nextDueDate ? formatDate(sale.nextDueDate) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusTone(sale.status)}>
                          {t(`installmentSales.statuses.${sale.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {t("common.noData")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <CreateInstallmentSaleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />
      <SaleDetailsDialog
        sale={selectedSale}
        onOpenChange={(open) => !open && setSelectedSale(null)}
      />
    </div>
  );
}

function Metric({
  title,
  value,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <strong>{value}</strong>
        </div>
      </CardContent>
    </Card>
  );
}

function CurrencyMetricValue({
  amounts,
  fallbackCurrency,
  iqdPreference,
}: {
  amounts: Array<[CurrencyCode, number]>;
  fallbackCurrency: CurrencyCode;
  iqdPreference: Parameters<typeof formatCurrency>[2];
}) {
  const entries = amounts.length ? amounts : [[fallbackCurrency, 0] as const];
  return (
    <span className="flex flex-col">
      {entries.map(([currency, amount]) => (
        <span key={currency}>
          {formatCurrency(amount, currency, iqdPreference)}
        </span>
      ))}
    </span>
  );
}
