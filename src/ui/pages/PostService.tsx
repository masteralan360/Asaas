import { type FormEvent, useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Banknote, CheckCircle2, CircleDollarSign, ClipboardList, History, PackageCheck, Pencil, Plus, Route, Send, Store, Trash2, Truck, Undo2, Users, WalletCards, X } from "lucide-react";

import { useAuth } from "@/auth";
import {
  closeDeliveryRun, createDeliveryMerchantProfile, createDeliveryRun, createDeliveryShipment, hardDeleteDeliveryMerchantProfile, payDeliveryMerchant,
  refreshPostServiceTab, settleDeliveryCourier, updateDeliveryMerchantProfile, updateDeliveryShipmentStatus, useAgents, useBusinessPartners, useCourierDeliveryBalances,
  useDeliveryMerchantProfiles, useDeliveryRuns, useDeliverySettlements, useDeliveryShipments, useFleetVehicles,
  useMerchantDeliveryBalances, type BusinessPartner, type CurrencyCode, type DeliveryMerchantProfile, type DeliveryShipment, type DeliveryShipmentStatus, type PostServiceTab, type WorkspacePaymentMethod,
} from "@/local-db";
import { formatCurrency, formatDateTime, formatNumericInput, parseFormattedNumber, sanitizeNumericInput } from "@/lib/utils";
import { useWorkspacePermissions } from "@/permissions";
import { ModulePageFreshness } from "@/ui/components/ModulePageFreshness";
import { PartnerAutocompleteInput } from "@/ui/components/crm/PartnerAutocompleteInput";
import { DeleteConfirmationModal } from "@/ui/components/DeleteConfirmationModal";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, CurrencySelector, Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger,
  SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList,
  TabsTrigger, Textarea, useToast,
} from "@/ui/components";
import { useWorkspace } from "@/workspace";

type ShipmentForm = {
  merchantProfileId: string; recipientName: string; recipientPhone: string; recipientAlternatePhone: string;
  recipientAddress: string; recipientCity: string; description: string; currency: CurrencyCode;
  codAmount: string; deliveryFee: string; feePayer: "merchant" | "recipient";
};

const initialShipmentForm = (currency: CurrencyCode): ShipmentForm => ({
  merchantProfileId: "", recipientName: "", recipientPhone: "", recipientAlternatePhone: "", recipientAddress: "",
  recipientCity: "", description: "", currency, codAmount: "", deliveryFee: "", feePayer: "merchant",
});

function shipmentStatusClass(status: DeliveryShipmentStatus) {
  if (status === "delivered") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "returned" || status === "cancelled") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "postponed") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "assigned") return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-border bg-muted text-muted-foreground";
}

function shipmentStatusLabel(t: TFunction, status: DeliveryShipmentStatus) {
  return t(`postService.status.${status}`);
}

function currencySuffix(currency: CurrencyCode, iqdPreference: "IQD" | "د.ع") {
  return currency === "iqd" ? iqdPreference : currency === "usd" ? "$" : currency.toUpperCase();
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localizedError(t: TFunction, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const keys: Record<string, string> = {
    "Select a business partner in this workspace": "selectBusinessPartner",
    "Select an active delivery merchant": "selectMerchant",
    "Recipient name, phone, and address are required": "recipientRequired",
    "Select an active courier": "selectCourier",
    "Select at least one shipment": "selectShipment",
    "Only unassigned, ready, or postponed shipments can be dispatched": "shipmentNotDispatchable",
    "Shipment not found": "shipmentNotFound",
    "A completed shipment cannot be changed. Record an adjustment instead.": "completedShipment",
    "A reason is required for this status": "reasonRequired",
    "Assign the shipment to a courier first": "assignCourierFirst",
    "A courier can only update shipments assigned to them": "courierAssignmentOnly",
    "Settlement amount cannot exceed the outstanding balance": "amountExceedsBalance",
    "Explain a partial settlement before confirming it": "partialExplanationRequired",
    "Courier not found": "courierNotFound",
    "Merchant not found": "merchantNotFound",
    "A merchant with delivery history cannot be permanently deleted. Make it inactive instead.": "merchantDeleteHistory",
  };
  return keys[message] ? t(`postService.errors.${keys[message]}`) : message || t("postService.errors.generic");
}

export function PostService() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { features } = useWorkspace();
  const { hasPermission } = useWorkspacePermissions();
  const { toast } = useToast();
  const workspaceId = user?.workspaceId;
  const isEditor = user?.role === "admin" || user?.role === "staff";
  const canDispatch = isEditor && hasPermission("postService.dispatch");
  const canSettle = isEditor && hasPermission("postService.settle");
  const currencies = useMemo(() => Array.from(new Set([features.default_currency, ...features.allowed_currencies])) as CurrencyCode[], [features.allowed_currencies, features.default_currency]);
  const partners = useBusinessPartners(workspaceId, { includeAgentRoles: true });
  const agents = useAgents(workspaceId);
  const vehicles = useFleetVehicles(workspaceId);
  const merchantProfiles = useDeliveryMerchantProfiles(workspaceId);
  const shipments = useDeliveryShipments(workspaceId);
  const runs = useDeliveryRuns(workspaceId);
  const settlements = useDeliverySettlements(workspaceId);
  const courierBalances = useCourierDeliveryBalances(workspaceId);
  const merchantBalances = useMerchantDeliveryBalances(workspaceId);
  const [activeTab, setActiveTab] = useState<PostServiceTab>("posts");
  const [shipmentDialogOpen, setShipmentDialogOpen] = useState(false);
  const [shipmentForm, setShipmentForm] = useState<ShipmentForm>(() => initialShipmentForm(features.default_currency));
  const [merchantDialogOpen, setMerchantDialogOpen] = useState(false);
  const [merchantName, setMerchantName] = useState("");
  const [selectedMerchantPartner, setSelectedMerchantPartner] = useState<BusinessPartner | null>(null);
  const [merchantFee, setMerchantFee] = useState("");
  const [merchantPayoutSchedule, setMerchantPayoutSchedule] = useState<"daily" | "weekly" | "on_request">("daily");
  const [merchantFeePayer, setMerchantFeePayer] = useState<"merchant" | "recipient">("merchant");
  const [editingMerchantProfile, setEditingMerchantProfile] = useState<DeliveryMerchantProfile | null>(null);
  const [merchantEditDialogOpen, setMerchantEditDialogOpen] = useState(false);
  const [merchantDeleteTarget, setMerchantDeleteTarget] = useState<DeliveryMerchantProfile | null>(null);
  const [isDeletingMerchant, setIsDeletingMerchant] = useState(false);
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string>>(new Set());
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [dispatchVehicleId, setDispatchVehicleId] = useState("none");
  const [dispatchNotes, setDispatchNotes] = useState("");
  const [statusTarget, setStatusTarget] = useState<DeliveryShipment | null>(null);
  const [nextStatus, setNextStatus] = useState<"delivered" | "postponed" | "returned">("delivered");
  const [statusNote, setStatusNote] = useState("");
  const [settlementTarget, setSettlementTarget] = useState<{ kind: "courier" | "merchant"; id: string; currency: CurrencyCode; amount: number; name: string } | null>(null);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementMethod, setSettlementMethod] = useState<WorkspacePaymentMethod>("cash");
  const [settlementNote, setSettlementNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const partnerById = useMemo(() => new Map(partners.map((partner) => [partner.id, partner])), [partners]);
  const agentNameById = useMemo(() => new Map(agents.map((agent) => [agent.id, partnerById.get(agent.businessPartnerId)?.name ?? t("postService.unknownCourier")])), [agents, partnerById, t]);
  const profileById = useMemo(() => new Map(merchantProfiles.map((profile) => [profile.id, profile])), [merchantProfiles]);
  const profileNameById = useMemo(() => new Map(merchantProfiles.map((profile) => [profile.id, partnerById.get(profile.businessPartnerId)?.name ?? t("postService.unknownMerchant")])), [merchantProfiles, partnerById, t]);
  const linkedCourier = agents.find((agent) => agent.linkedUserId === user?.id && agent.status === "active");
  const assignableShipments = shipments.filter((shipment) => ["received", "ready_for_dispatch", "postponed"].includes(shipment.status));
  const selectedCount = selectedShipmentIds.size;
  const assignedCount = shipments.filter((shipment) => shipment.status === "assigned").length;
  const deliveredToday = shipments.filter((shipment) => shipment.status === "delivered" && shipment.deliveredAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const enabledMerchantPartnerIds = useMemo(() => merchantProfiles.map((profile) => profile.businessPartnerId), [merchantProfiles]);

  const handleTabChange = useCallback((value: string) => {
    const tab = value as PostServiceTab;
    setActiveTab(tab);
    if (workspaceId) {
      void refreshPostServiceTab(workspaceId, tab).catch((error) =>
        console.error(`[Post Service] Failed to refresh ${tab}:`, error),
      );
    }
  }, [workspaceId]);

  function updateShipmentForm<Key extends keyof ShipmentForm>(key: Key, value: ShipmentForm[Key]) {
    setShipmentForm((current) => ({ ...current, [key]: value }));
  }
  function toggleShipment(shipmentId: string, checked: boolean) {
    setSelectedShipmentIds((current) => { const next = new Set(current); if (checked) next.add(shipmentId); else next.delete(shipmentId); return next; });
  }
  function openStatusDialog(shipment: DeliveryShipment, status: "delivered" | "postponed" | "returned") {
    setStatusTarget(shipment); setNextStatus(status); setStatusNote("");
  }
  function openSettlement(target: NonNullable<typeof settlementTarget>) {
    setSettlementTarget(target); setSettlementAmount(String(target.amount)); setSettlementMethod("cash"); setSettlementNote("");
  }
  async function handleCreateMerchant(event: FormEvent) {
    event.preventDefault(); if (!workspaceId || !selectedMerchantPartner) return; setIsSubmitting(true);
    try {
      await createDeliveryMerchantProfile(workspaceId, { businessPartnerId: selectedMerchantPartner.id, defaultFeeAmount: parseFormattedNumber(merchantFee || "0"), defaultFeePayer: merchantFeePayer, payoutSchedule: merchantPayoutSchedule });
      toast({ title: t("postService.messages.merchantEnabled"), description: t("postService.messages.merchantEnabledDescription") });
      setMerchantDialogOpen(false); setSelectedMerchantPartner(null); setMerchantName(""); setMerchantFee("");
    } catch (error) { toast({ title: t("postService.messages.enableMerchantFailed"), description: localizedError(t, error), variant: "destructive" }); } finally { setIsSubmitting(false); }
  }
  async function handleCreateShipment(event: FormEvent) {
    event.preventDefault(); if (!workspaceId) return; setIsSubmitting(true);
    try {
      await createDeliveryShipment(workspaceId, { merchantProfileId: shipmentForm.merchantProfileId, recipientName: shipmentForm.recipientName, recipientPhone: shipmentForm.recipientPhone, recipientAlternatePhone: shipmentForm.recipientAlternatePhone || null, recipientAddress: shipmentForm.recipientAddress, recipientCity: shipmentForm.recipientCity || null, description: shipmentForm.description || null, currency: shipmentForm.currency, codAmount: parseFormattedNumber(shipmentForm.codAmount || "0"), deliveryFee: parseFormattedNumber(shipmentForm.deliveryFee || "0"), feePayer: shipmentForm.feePayer, createdBy: user?.id ?? null });
      toast({ title: t("postService.messages.postCreated"), description: t("postService.messages.postCreatedDescription") });
      setShipmentDialogOpen(false); setShipmentForm(initialShipmentForm(features.default_currency));
    } catch (error) { toast({ title: t("postService.messages.createPostFailed"), description: localizedError(t, error), variant: "destructive" }); } finally { setIsSubmitting(false); }
  }
  function openMerchantEditor(profile: DeliveryMerchantProfile) {
    setEditingMerchantProfile(profile);
    setMerchantFee(String(profile.defaultFeeAmount));
    setMerchantFeePayer(profile.defaultFeePayer);
    setMerchantPayoutSchedule(profile.payoutSchedule);
    setMerchantEditDialogOpen(true);
  }
  async function handleUpdateMerchant(event: FormEvent) {
    event.preventDefault();
    if (!editingMerchantProfile) return;
    setIsSubmitting(true);
    try {
      await updateDeliveryMerchantProfile(editingMerchantProfile.id, {
        defaultFeeAmount: parseFormattedNumber(merchantFee || "0"),
        defaultFeePayer: merchantFeePayer,
        payoutSchedule: merchantPayoutSchedule,
        isActive: editingMerchantProfile.isActive,
      });
      toast({ title: t("postService.messages.merchantUpdated") });
      setMerchantEditDialogOpen(false);
      setEditingMerchantProfile(null);
    } catch (error) {
      toast({ title: t("postService.messages.updateMerchantFailed"), description: localizedError(t, error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }
  async function handleDeleteMerchant() {
    if (!merchantDeleteTarget) return;
    setIsDeletingMerchant(true);
    try {
      await hardDeleteDeliveryMerchantProfile(merchantDeleteTarget.id);
      toast({ title: t("postService.messages.merchantDeleted") });
      setMerchantDeleteTarget(null);
    } catch (error) {
      toast({ title: t("postService.messages.deleteMerchantFailed"), description: localizedError(t, error), variant: "destructive" });
    } finally {
      setIsDeletingMerchant(false);
    }
  }
  async function handleDispatch(event: FormEvent) {
    event.preventDefault(); if (!workspaceId) return; setIsSubmitting(true);
    try {
      const run = await createDeliveryRun(workspaceId, { agentId: dispatchAgentId, shipmentIds: [...selectedShipmentIds], vehicleId: dispatchVehicleId === "none" ? null : dispatchVehicleId, notes: dispatchNotes || null, createdBy: user?.id ?? null });
      toast({ title: t("postService.messages.dispatchCreated"), description: t("postService.messages.dispatchCreatedDescription", { run: run.runNumber }) });
      setSelectedShipmentIds(new Set()); setDispatchAgentId(""); setDispatchVehicleId("none"); setDispatchNotes("");
    } catch (error) { toast({ title: t("postService.messages.dispatchFailed"), description: localizedError(t, error), variant: "destructive" }); } finally { setIsSubmitting(false); }
  }
  async function handleStatusUpdate(event: FormEvent) {
    event.preventDefault(); if (!statusTarget) return; setIsSubmitting(true);
    try {
      await updateDeliveryShipmentStatus(statusTarget.id, { status: nextStatus, note: statusNote || null, actorUserId: user?.id ?? null, actorAgentId: linkedCourier?.id ?? null });
      toast({ title: t("postService.messages.postMarked", { status: shipmentStatusLabel(t, nextStatus) }) }); setStatusTarget(null);
    } catch (error) { toast({ title: t("postService.messages.updatePostFailed"), description: localizedError(t, error), variant: "destructive" }); } finally { setIsSubmitting(false); }
  }
  async function handleSettlement(event: FormEvent) {
    event.preventDefault(); if (!workspaceId || !settlementTarget) return; setIsSubmitting(true);
    try {
      const payload = { currency: settlementTarget.currency, actualAmount: numericValue(settlementAmount), paymentMethod: settlementMethod, note: settlementNote || null, varianceNote: numericValue(settlementAmount) === settlementTarget.amount ? null : settlementNote || null, createdBy: user?.id ?? null };
      if (settlementTarget.kind === "courier") await settleDeliveryCourier(workspaceId, { ...payload, agentId: settlementTarget.id });
      else await payDeliveryMerchant(workspaceId, { ...payload, merchantProfileId: settlementTarget.id });
      toast({ title: t(settlementTarget.kind === "courier" ? "postService.messages.courierHandoverRecorded" : "postService.messages.merchantPayoutRecorded") }); setSettlementTarget(null);
    } catch (error) { toast({ title: t("postService.messages.settlementFailed"), description: localizedError(t, error), variant: "destructive" }); } finally { setIsSubmitting(false); }
  }
  async function handleCloseRun(runId: string) {
    try { await closeDeliveryRun(runId); toast({ title: t("postService.messages.runClosed") }); }
    catch (error) { toast({ title: t("postService.messages.closeRunFailed"), description: localizedError(t, error), variant: "destructive" }); }
  }

  if (!workspaceId) return null;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><PackageCheck className="h-6 w-6 text-primary" />{t("postService.title")}</h1><p className="text-muted-foreground">{t("postService.subtitle")} <ModulePageFreshness className="ms-2" /></p></div>{isEditor && <div className="flex flex-wrap gap-2"><Button variant="outline" className="gap-2" onClick={() => setMerchantDialogOpen(true)}><Store className="h-4 w-4" />{t("postService.actions.enableMerchant")}</Button><Button className="gap-2" onClick={() => setShipmentDialogOpen(true)}><Plus className="h-4 w-4" />{t("postService.actions.newPost")}</Button></div>}</div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={PackageCheck} title={t("postService.metrics.readyToDispatch")} value={assignableShipments.length} /><Metric icon={Truck} title={t("postService.metrics.withCourier")} value={assignedCount} /><Metric icon={CheckCircle2} title={t("postService.metrics.deliveredToday")} value={deliveredToday} /><Metric icon={WalletCards} title={t("postService.metrics.courierCashBalances")} value={courierBalances.length} detail={t("postService.metrics.openBalances")} /><Metric icon={CircleDollarSign} title={t("postService.metrics.merchantPayables")} value={merchantBalances.length} detail={t("postService.metrics.openBalances")} /></div>
    <Tabs value={activeTab} onValueChange={handleTabChange}><TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto"><TabsTrigger value="posts"><ClipboardList className="mr-2 h-4 w-4" />{t("postService.tabs.posts")}</TabsTrigger><TabsTrigger value="dispatch"><Send className="mr-2 h-4 w-4" />{t("postService.tabs.dispatch")}</TabsTrigger><TabsTrigger value="my-deliveries"><Route className="mr-2 h-4 w-4" />{t("postService.tabs.myDeliveries")}</TabsTrigger><TabsTrigger value="merchants"><Store className="mr-2 h-4 w-4" />{t("postService.tabs.merchants")}</TabsTrigger><TabsTrigger value="settlements"><Banknote className="mr-2 h-4 w-4" />{t("postService.tabs.settlements")}</TabsTrigger></TabsList>
      <TabsContent value="posts" className="mt-4"><Card><CardHeader className="flex-row items-center justify-between gap-4"><CardTitle>{t("postService.cards.allPosts")}</CardTitle><span className="text-sm text-muted-foreground">{t("postService.selectedForDispatch", { count: selectedCount })}</span></CardHeader><CardContent className="overflow-x-auto"><ShipmentTable t={t} shipments={shipments} selectedIds={selectedShipmentIds} onToggle={toggleShipment} canSelect={canDispatch} profileNameById={profileNameById} agentNameById={agentNameById} onStatus={openStatusDialog} canUpdate={isEditor} iqdPreference={features.iqd_display_preference} /></CardContent></Card></TabsContent>
      <TabsContent value="dispatch" className="mt-4 space-y-4"><Card><CardHeader><CardTitle>{t("postService.cards.createManifest")}</CardTitle></CardHeader><CardContent>{canDispatch ? <form className="grid gap-4 md:grid-cols-2" onSubmit={handleDispatch}><Field label={t("postService.form.postsSelected")}><div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{t("postService.selectedAndAvailable", { selected: selectedCount, available: assignableShipments.length })}</div></Field><Field label={t("postService.form.courier")}><Select value={dispatchAgentId} onValueChange={setDispatchAgentId}><SelectTrigger><SelectValue placeholder={t("postService.placeholders.selectCourier")} /></SelectTrigger><SelectContent>{agents.filter((agent) => agent.status === "active").map((agent) => <SelectItem key={agent.id} value={agent.id}>{agentNameById.get(agent.id)} · {agent.zone}</SelectItem>)}</SelectContent></Select></Field><Field label={t("postService.form.vehicleOptional")}><Select value={dispatchVehicleId} onValueChange={setDispatchVehicleId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("postService.options.noVehicle")}</SelectItem>{vehicles.filter((vehicle) => vehicle.status === "active").map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} · {vehicle.model}</SelectItem>)}</SelectContent></Select></Field><Field label={t("postService.form.manifestNote")}><Input value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} placeholder={t("postService.placeholders.manifestNote")} /></Field><div className="md:col-span-2"><Button disabled={isSubmitting || !dispatchAgentId || selectedCount === 0} type="submit"><Send className="mr-2 h-4 w-4" />{t("postService.actions.assignSelected")}</Button></div></form> : <p className="text-sm text-muted-foreground">{t("postService.permissionRequired.dispatch")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("postService.cards.recentRuns")}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t("postService.table.run")}</TableHead><TableHead>{t("postService.table.courier")}</TableHead><TableHead>{t("postService.table.dispatched")}</TableHead><TableHead>{t("postService.table.status")}</TableHead><TableHead /></TableRow></TableHeader><TableBody>{runs.length === 0 ? <EmptyRow columns={5} label={t("postService.empty.noRuns")} /> : runs.map((run) => <TableRow key={run.id}><TableCell className="font-medium">{run.runNumber}</TableCell><TableCell>{agentNameById.get(run.agentId)}</TableCell><TableCell>{formatDateTime(run.dispatchedAt)}</TableCell><TableCell><Badge variant="outline">{t(`postService.runStatus.${run.status}`)}</Badge></TableCell><TableCell className="text-right">{canDispatch && run.status === "open" && <Button size="sm" variant="outline" onClick={() => void handleCloseRun(run.id)}>{t("postService.actions.closeRun")}</Button>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="my-deliveries" className="mt-4"><Card><CardHeader><CardTitle>{t("postService.cards.myAssignedPosts")}</CardTitle></CardHeader><CardContent className="overflow-x-auto">{linkedCourier ? <ShipmentTable t={t} shipments={shipments.filter((shipment) => shipment.assignedAgentId === linkedCourier.id)} selectedIds={new Set()} onToggle={() => undefined} canSelect={false} profileNameById={profileNameById} agentNameById={agentNameById} onStatus={openStatusDialog} canUpdate={isEditor} iqdPreference={features.iqd_display_preference} /> : <div className="py-10 text-center text-sm text-muted-foreground">{t("postService.empty.noLinkedCourier")}</div>}</CardContent></Card></TabsContent>
      <TabsContent value="merchants" className="mt-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>{t("postService.cards.deliveryMerchants")}</CardTitle>{isEditor && <Button size="sm" onClick={() => setMerchantDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />{t("postService.actions.enableMerchant")}</Button>}</CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{t("postService.table.merchant")}</TableHead><TableHead>{t("postService.table.defaultFee")}</TableHead><TableHead>{t("postService.table.feePayer")}</TableHead><TableHead>{t("postService.table.payoutSchedule")}</TableHead><TableHead>{t("postService.table.status")}</TableHead><TableHead className="text-right">{t("postService.table.actions")}</TableHead></TableRow></TableHeader>
              <TableBody>{merchantProfiles.length === 0 ? <EmptyRow columns={6} label={t("postService.empty.noMerchants")} /> : merchantProfiles.map((profile) => <TableRow key={profile.id}><TableCell className="font-medium">{profileNameById.get(profile.id)}</TableCell><TableCell>{formatCurrency(profile.defaultFeeAmount, features.default_currency, features.iqd_display_preference)}</TableCell><TableCell>{t(`postService.feePayer.${profile.defaultFeePayer}`)}</TableCell><TableCell>{t(`postService.payoutSchedule.${profile.payoutSchedule}`)}</TableCell><TableCell><Badge variant="outline" className={profile.isActive ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "text-muted-foreground"}>{t(profile.isActive ? "postService.active" : "postService.inactive")}</Badge></TableCell><TableCell className="text-right">{isEditor && <div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" title={t("postService.actions.editMerchant")} onClick={() => openMerchantEditor(profile)}><Pencil className="h-4 w-4" /></Button><Button type="button" size="icon" variant="ghost" className="text-destructive hover:text-destructive" title={t("postService.actions.deleteMerchant")} onClick={() => setMerchantDeleteTarget(profile)}><Trash2 className="h-4 w-4" /></Button></div>}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="settlements" className="mt-4 space-y-4"><SettlementBalances t={t} title={t("postService.cards.courierHandovers")} icon={WalletCards} balances={courierBalances} getName={(id) => agentNameById.get(id) ?? t("postService.unknownCourier")} action={t("postService.actions.recordHandover")} canSettle={canSettle} onSettle={(balance) => openSettlement({ kind: "courier", ...balance, name: agentNameById.get(balance.id) ?? t("postService.unknownCourier") })} iqdPreference={features.iqd_display_preference} /><SettlementBalances t={t} title={t("postService.cards.merchantPayouts")} icon={CircleDollarSign} balances={merchantBalances} getName={(id) => profileNameById.get(id) ?? t("postService.unknownMerchant")} action={t("postService.actions.payMerchant")} canSettle={canSettle} onSettle={(balance) => openSettlement({ kind: "merchant", ...balance, name: profileNameById.get(balance.id) ?? t("postService.unknownMerchant") })} iqdPreference={features.iqd_display_preference} /><Card><CardHeader><CardTitle>{t("postService.cards.settlementHistory")}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t("postService.table.reference")}</TableHead><TableHead>{t("postService.table.type")}</TableHead><TableHead>{t("postService.table.amount")}</TableHead><TableHead>{t("postService.table.time")}</TableHead></TableRow></TableHeader><TableBody>{settlements.length === 0 ? <EmptyRow columns={4} label={t("postService.empty.noSettlements")} /> : settlements.slice(0, 20).map((settlement) => <TableRow key={settlement.id}><TableCell className="font-medium">{settlement.settlementNumber}</TableCell><TableCell>{t(settlement.type === "courier_remittance" ? "postService.settlementType.courierRemittance" : "postService.settlementType.merchantPayout")}</TableCell><TableCell>{formatCurrency(settlement.actualAmount, settlement.currency, features.iqd_display_preference)}</TableCell><TableCell>{formatDateTime(settlement.settledAt)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>
    <Dialog open={merchantDialogOpen} onOpenChange={setMerchantDialogOpen}>
      <DialogContent layout="structured" className="sm:max-w-lg">
        <DialogHeader layout="structured">
          <DialogTitle>{t("postService.dialogs.enableMerchant.title")}</DialogTitle>
          <DialogDescription>{t("postService.dialogs.enableMerchant.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateMerchant} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-5">
            <Field label={t("postService.form.businessPartner")}>
              <div className="flex flex-col gap-2">
                <PartnerAutocompleteInput
                  value={merchantName}
                  onChange={(value) => { setMerchantName(value); setSelectedMerchantPartner((current) => current && value.trim() !== current.name ? null : current); }}
                  onSelectPartner={(partner: BusinessPartner) => { setSelectedMerchantPartner(partner); setMerchantName(partner.name); }}
                  workspaceId={workspaceId}
                  placeholder={t("postService.placeholders.selectMerchantOrShop")}
                  excludePartnerIds={enabledMerchantPartnerIds}
                />
                {selectedMerchantPartner ? <LinkedMerchantBadge t={t} name={selectedMerchantPartner.name} onClear={() => { setSelectedMerchantPartner(null); setMerchantName(""); }} /> : null}
              </div>
            </Field>
            <Field label={t("postService.form.defaultDeliveryFee")}><div className="relative"><Input className="pr-12" value={formatNumericInput(merchantFee)} onChange={(event) => setMerchantFee(sanitizeNumericInput(event.target.value, { allowDecimal: true }))} inputMode="decimal" placeholder="0" required /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{currencySuffix(features.default_currency, features.iqd_display_preference)}</span></div></Field>
            <Field label={t("postService.form.feePayer")}>
              <Select value={merchantFeePayer} onValueChange={(value: "merchant" | "recipient") => setMerchantFeePayer(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merchant">{t("postService.feePayer.merchantDeducted")}</SelectItem>
                  <SelectItem value="recipient">{t("postService.feePayer.recipientCollected")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("postService.form.payoutSchedule")}>
              <Select value={merchantPayoutSchedule} onValueChange={(value: "daily" | "weekly" | "on_request") => setMerchantPayoutSchedule(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t("postService.payoutSchedule.daily")}</SelectItem>
                  <SelectItem value="weekly">{t("postService.payoutSchedule.weekly")}</SelectItem>
                  <SelectItem value="on_request">{t("postService.payoutSchedule.on_request")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter layout="structured">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setMerchantDialogOpen(false)}>{t("postService.actions.cancel")}</Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting || !selectedMerchantPartner || !merchantFee}>{t("postService.actions.enableMerchant")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={merchantEditDialogOpen} onOpenChange={(open) => { setMerchantEditDialogOpen(open); if (!open) setEditingMerchantProfile(null); }}>
      <DialogContent layout="structured" className="sm:max-w-lg">
        <DialogHeader layout="structured">
          <DialogTitle>{t("postService.dialogs.editMerchant.title")}</DialogTitle>
          <DialogDescription>{editingMerchantProfile && t("postService.dialogs.editMerchant.description", { name: profileNameById.get(editingMerchantProfile.id) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleUpdateMerchant} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-5">
            <Field label={t("postService.form.defaultDeliveryFee")}><div className="relative"><Input className="pr-12" value={formatNumericInput(merchantFee)} onChange={(event) => setMerchantFee(sanitizeNumericInput(event.target.value, { allowDecimal: true }))} inputMode="decimal" placeholder="0" required /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{currencySuffix(features.default_currency, features.iqd_display_preference)}</span></div></Field>
            <Field label={t("postService.form.feePayer")}><Select value={merchantFeePayer} onValueChange={(value: "merchant" | "recipient") => setMerchantFeePayer(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="merchant">{t("postService.feePayer.merchantDeducted")}</SelectItem><SelectItem value="recipient">{t("postService.feePayer.recipientCollected")}</SelectItem></SelectContent></Select></Field>
            <Field label={t("postService.form.payoutSchedule")}><Select value={merchantPayoutSchedule} onValueChange={(value: "daily" | "weekly" | "on_request") => setMerchantPayoutSchedule(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">{t("postService.payoutSchedule.daily")}</SelectItem><SelectItem value="weekly">{t("postService.payoutSchedule.weekly")}</SelectItem><SelectItem value="on_request">{t("postService.payoutSchedule.on_request")}</SelectItem></SelectContent></Select></Field>
            <Field label={t("postService.form.status")}><Select value={editingMerchantProfile?.isActive ? "active" : "inactive"} onValueChange={(value: "active" | "inactive") => setEditingMerchantProfile((current) => current ? { ...current, isActive: value === "active" } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">{t("postService.active")}</SelectItem><SelectItem value="inactive">{t("postService.inactive")}</SelectItem></SelectContent></Select></Field>
          </DialogBody>
          <DialogFooter layout="structured"><Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setMerchantEditDialogOpen(false)}>{t("postService.actions.cancel")}</Button><Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting || !merchantFee}>{t("postService.actions.saveMerchant")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <DeleteConfirmationModal
      isOpen={!!merchantDeleteTarget}
      onClose={() => setMerchantDeleteTarget(null)}
      onConfirm={handleDeleteMerchant}
      isLoading={isDeletingMerchant}
      itemName={merchantDeleteTarget ? profileNameById.get(merchantDeleteTarget.id) : ""}
      title={t("postService.dialogs.deleteMerchant.title")}
      description={t("postService.dialogs.deleteMerchant.description")}
    />
    <Dialog open={shipmentDialogOpen} onOpenChange={setShipmentDialogOpen}>
      <DialogContent layout="structured" className="sm:max-w-2xl">
        <DialogHeader layout="structured">
          <DialogTitle>{t("postService.dialogs.newPost.title")}</DialogTitle>
          <DialogDescription>{t("postService.dialogs.newPost.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateShipment} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-5 sm:grid-cols-2">
            <Field label={t("postService.form.merchant")}>
              <Select value={shipmentForm.merchantProfileId} onValueChange={(value) => { const profile = profileById.get(value); updateShipmentForm("merchantProfileId", value); if (profile) { updateShipmentForm("deliveryFee", String(profile.defaultFeeAmount)); updateShipmentForm("feePayer", profile.defaultFeePayer); } }}>
                <SelectTrigger><SelectValue placeholder={t("postService.placeholders.selectMerchant")} /></SelectTrigger>
                <SelectContent>
                  {merchantProfiles.filter((profile) => profile.isActive).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profileNameById.get(profile.id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("postService.form.recipientName")}><Input value={shipmentForm.recipientName} onChange={(event) => updateShipmentForm("recipientName", event.target.value)} /></Field>
            <Field label={t("postService.form.recipientPhone")}><Input value={shipmentForm.recipientPhone} onChange={(event) => updateShipmentForm("recipientPhone", event.target.value)} /></Field>
            <Field label={t("postService.form.alternatePhone")}><Input value={shipmentForm.recipientAlternatePhone} onChange={(event) => updateShipmentForm("recipientAlternatePhone", event.target.value)} /></Field>
            <div className="sm:col-span-2">
              <Field label={t("postService.form.deliveryAddress")}><Textarea value={shipmentForm.recipientAddress} onChange={(event) => updateShipmentForm("recipientAddress", event.target.value)} /></Field>
            </div>
            <Field label={t("postService.form.cityZone")}><Input value={shipmentForm.recipientCity} onChange={(event) => updateShipmentForm("recipientCity", event.target.value)} /></Field>
            <Field label={t("postService.form.description")}><Input value={shipmentForm.description} onChange={(event) => updateShipmentForm("description", event.target.value)} placeholder={t("postService.placeholders.parcelDescription")} /></Field>
            <Field label={t("postService.form.codAmount")}><div className="relative"><Input className="pr-12" value={formatNumericInput(shipmentForm.codAmount)} onChange={(event) => updateShipmentForm("codAmount", sanitizeNumericInput(event.target.value, { allowDecimal: shipmentForm.currency !== "iqd" }))} inputMode={shipmentForm.currency === "iqd" ? "numeric" : "decimal"} placeholder="0" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{currencySuffix(shipmentForm.currency, features.iqd_display_preference)}</span></div></Field>
            <Field label={t("postService.form.deliveryFee")}><div className="relative"><Input className="pr-12" value={formatNumericInput(shipmentForm.deliveryFee)} onChange={(event) => updateShipmentForm("deliveryFee", sanitizeNumericInput(event.target.value, { allowDecimal: shipmentForm.currency !== "iqd" }))} inputMode={shipmentForm.currency === "iqd" ? "numeric" : "decimal"} placeholder="0" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{currencySuffix(shipmentForm.currency, features.iqd_display_preference)}</span></div></Field>
            <CurrencySelector value={shipmentForm.currency} onChange={(value: CurrencyCode) => updateShipmentForm("currency", value)} label={t("postService.form.currency")} iqdDisplayPreference={features.iqd_display_preference} allowedCurrencies={currencies} />
            <Field label={t("postService.form.feePayer")}>
              <Select value={shipmentForm.feePayer} onValueChange={(value: "merchant" | "recipient") => updateShipmentForm("feePayer", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merchant">{t("postService.feePayer.merchant")}</SelectItem>
                  <SelectItem value="recipient">{t("postService.feePayer.recipient")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter layout="structured">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShipmentDialogOpen(false)}>{t("postService.actions.cancel")}</Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting || !shipmentForm.merchantProfileId}>{t("postService.actions.createPost")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!statusTarget} onOpenChange={(open) => !open && setStatusTarget(null)}><DialogContent className="sm:max-w-md"><form onSubmit={handleStatusUpdate}><DialogHeader><DialogTitle>{t("postService.dialogs.status.title", { status: shipmentStatusLabel(t, nextStatus) })}</DialogTitle><DialogDescription>{statusTarget?.trackingNumber} · {statusTarget?.recipientName}</DialogDescription></DialogHeader><div className="py-5"><Field label={nextStatus === "delivered" ? t("postService.form.optionalNote") : t("postService.form.reason")}><Textarea value={statusNote} onChange={(event) => setStatusNote(event.target.value)} required={nextStatus !== "delivered"} placeholder={nextStatus === "postponed" ? t("postService.placeholders.postponedReason") : nextStatus === "returned" ? t("postService.placeholders.returnedReason") : t("postService.placeholders.deliveryNote")} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setStatusTarget(null)}>{t("postService.actions.cancel")}</Button><Button disabled={isSubmitting} type="submit">{t("postService.actions.confirmStatus", { status: shipmentStatusLabel(t, nextStatus) })}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!settlementTarget} onOpenChange={(open) => !open && setSettlementTarget(null)}><DialogContent className="sm:max-w-md"><form onSubmit={handleSettlement}><DialogHeader><DialogTitle>{t(settlementTarget?.kind === "courier" ? "postService.dialogs.courierSettlement.title" : "postService.dialogs.merchantSettlement.title")}</DialogTitle><DialogDescription>{t("postService.dialogs.settlementOutstanding", { name: settlementTarget?.name, amount: settlementTarget && formatCurrency(settlementTarget.amount, settlementTarget.currency, features.iqd_display_preference) })}</DialogDescription></DialogHeader><div className="grid gap-4 py-5"><Field label={t("postService.form.amountReceivedPaid")}><Input value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} inputMode="decimal" /></Field><Field label={t("postService.form.paymentMethod")}><Select value={settlementMethod} onValueChange={(value: WorkspacePaymentMethod) => setSettlementMethod(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{t("postService.paymentMethods.cash")}</SelectItem><SelectItem value="bank_transfer">{t("postService.paymentMethods.bank_transfer")}</SelectItem><SelectItem value="fib">{t("postService.paymentMethods.fib")}</SelectItem><SelectItem value="qicard">{t("postService.paymentMethods.qicard")}</SelectItem><SelectItem value="zaincash">{t("postService.paymentMethods.zaincash")}</SelectItem><SelectItem value="fastpay">{t("postService.paymentMethods.fastpay")}</SelectItem></SelectContent></Select></Field><Field label={t("postService.form.noteVariance")}><Textarea value={settlementNote} onChange={(event) => setSettlementNote(event.target.value)} placeholder={t("postService.placeholders.varianceNote")} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setSettlementTarget(null)}>{t("postService.actions.cancel")}</Button><Button disabled={isSubmitting} type="submit">{t("postService.actions.confirmSettlement")}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}
function LinkedMerchantBadge({ t, name, onClear }: { t: TFunction; name: string; onClear: () => void }) {
  return <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm"><div className="flex min-w-0 items-center gap-2"><Users className="h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wide text-primary">{t("loans.belongsTo")}</div><div className="truncate font-medium">{name}</div></div></div><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClear} aria-label="Clear linked business partner"><X className="h-4 w-4" /></Button></div>;
}
function Metric({ icon: Icon, title, value, detail }: { icon: typeof PackageCheck; title: string; value: number; detail?: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{title}{detail ? ` · ${detail}` : ""}</div></div></CardContent></Card>;
}
function EmptyRow({ columns, label }: { columns: number; label: string }) {
  return <TableRow><TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">{label}</TableCell></TableRow>;
}
function ShipmentTable({ t, shipments, selectedIds, onToggle, canSelect, profileNameById, agentNameById, onStatus, canUpdate, iqdPreference }: { t: TFunction; shipments: DeliveryShipment[]; selectedIds: Set<string>; onToggle: (shipmentId: string, checked: boolean) => void; canSelect: boolean; profileNameById: Map<string, string>; agentNameById: Map<string, string>; onStatus: (shipment: DeliveryShipment, status: "delivered" | "postponed" | "returned") => void; canUpdate: boolean; iqdPreference: "IQD" | "د.ع" }) {
  return <Table><TableHeader><TableRow>{canSelect && <TableHead className="w-10" />}<TableHead>{t("postService.table.tracking")}</TableHead><TableHead>{t("postService.table.merchantRecipient")}</TableHead><TableHead>{t("postService.table.cod")}</TableHead><TableHead>{t("postService.table.courier")}</TableHead><TableHead>{t("postService.table.status")}</TableHead><TableHead className="text-right">{t("postService.table.actions")}</TableHead></TableRow></TableHeader><TableBody>{shipments.length === 0 ? <EmptyRow columns={canSelect ? 7 : 6} label={t("postService.empty.noPosts")} /> : shipments.map((shipment) => <TableRow key={shipment.id}>{canSelect && <TableCell><Checkbox checked={selectedIds.has(shipment.id)} disabled={!['received', 'ready_for_dispatch', 'postponed'].includes(shipment.status)} onCheckedChange={(checked) => onToggle(shipment.id, checked === true)} /></TableCell>}<TableCell><div className="font-medium">{shipment.trackingNumber}</div><div className="text-xs text-muted-foreground">{shipment.recipientCity || t("postService.table.noZone")}</div></TableCell><TableCell><div>{profileNameById.get(shipment.merchantProfileId)}</div><div className="text-xs text-muted-foreground">{shipment.recipientName} · {shipment.recipientPhone}</div></TableCell><TableCell>{formatCurrency(shipment.codAmount + (shipment.feePayer === "recipient" ? shipment.deliveryFee : 0), shipment.currency, iqdPreference)}</TableCell><TableCell>{shipment.assignedAgentId ? agentNameById.get(shipment.assignedAgentId) : "—"}</TableCell><TableCell><Badge variant="outline" className={shipmentStatusClass(shipment.status)}>{shipmentStatusLabel(t, shipment.status)}</Badge></TableCell><TableCell className="text-right">{canUpdate && shipment.status === "assigned" && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => onStatus(shipment, "delivered")} title={t("postService.actions.markDelivered")}><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button><Button size="sm" variant="ghost" onClick={() => onStatus(shipment, "postponed")} title={t("postService.actions.postpone")}><History className="h-4 w-4 text-amber-600" /></Button><Button size="sm" variant="ghost" onClick={() => onStatus(shipment, "returned")} title={t("postService.actions.return")}><Undo2 className="h-4 w-4 text-rose-600" /></Button></div>}</TableCell></TableRow>)}</TableBody></Table>;
}
function SettlementBalances({ t, title, icon: Icon, balances, getName, action, canSettle, onSettle, iqdPreference }: { t: TFunction; title: string; icon: typeof WalletCards; balances: Array<{ id: string; currency: CurrencyCode; amount: number }>; getName: (id: string) => string; action: string; canSettle: boolean; onSettle: (balance: { id: string; currency: CurrencyCode; amount: number }) => void; iqdPreference: "IQD" | "د.ع" }) {
  return <Card><CardHeader className="flex-row items-center gap-2"><Icon className="h-5 w-5 text-primary" /><CardTitle>{title}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t("postService.table.party")}</TableHead><TableHead>{t("postService.table.outstanding")}</TableHead><TableHead /></TableRow></TableHeader><TableBody>{balances.length === 0 ? <EmptyRow columns={3} label={t("postService.empty.noBalances")} /> : balances.map((balance) => <TableRow key={`${balance.id}-${balance.currency}`}><TableCell className="font-medium">{getName(balance.id)}</TableCell><TableCell>{formatCurrency(balance.amount, balance.currency, iqdPreference)}</TableCell><TableCell className="text-right">{canSettle && <Button size="sm" onClick={() => onSettle(balance)}>{action}</Button>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>;
}
