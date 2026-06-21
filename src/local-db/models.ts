// Data Models for Atlas
// All entities include sync metadata for offline-first architecture

export type SyncStatus = "pending" | "synced" | "conflict";

export type UserRole = "admin" | "staff" | "viewer";

export type CurrencyCode = "usd" | "eur" | "iqd" | "try";
export type WorkspaceDataMode = "cloud" | "local" | "hybrid" | "demo";
export type WorkspacePlan = "basic" | "business" | "enterprise";

export type PaymentMethod =
  | "cash"
  | "fib"
  | "qicard"
  | "zaincash"
  | "fastpay"
  | "loan";
export type LoanPaymentMethod =
  | PaymentMethod
  | "loan_adjustment"
  | "bank_transfer";
export type WorkspacePaymentMethod =
  | LoanPaymentMethod
  | "credit"
  | "bank_transfer"
  | "unknown";

export type IQDDisplayPreference = "IQD" | "د.ع";

export interface SyncMetadata {
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  version: number;
  isDeleted: boolean;
}

export interface BaseEntity extends SyncMetadata {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface User extends BaseEntity {
  email: string;
  name: string;
  role: UserRole;
  profileUrl?: string;
  monthlyTarget?: number;
  monthlyProgress?: number;
}

export interface ProductBarcode extends BaseEntity {
  productId: string;
  barcode: string;
  label?: string;
  isPrimary: boolean;
}

export interface Product extends BaseEntity {
  sku: string;
  name: string;
  description: string;
  categoryId?: string | null;
  category?: string | null;
  storageId?: string | null;
  storageName?: string;
  price: number;
  costPrice: number;
  quantity: number;
  minStockLevel: number;
  unit: string;
  currency: CurrencyCode;
  /** @deprecated Use the product_barcodes table instead. */
  barcode?: string;
  barcodes?: string[];
  imageUrl?: string;
  canBeReturned: boolean;
  returnRules?: string;
  createdBy?: string | null;
}

export interface Profile {
  id: string;
  workspaceId: string;
  currentWorkspaceId?: string;
  name: string;
  role: string;
  profile_url?: string | null;
  created_at?: string;
}

export interface LocalAccountCredential {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  salt: string;
  verifier: string;
  iterations: number;
  digest: "SHA-256";
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

export interface Category extends BaseEntity {
  name: string;
  description?: string;
  createdBy?: string | null;
}

export interface Storage extends BaseEntity {
  name: string;
  isSystem: boolean;
  isProtected: boolean;
  isPrimary: boolean;
  isMarketplace: boolean;
}

export interface Inventory extends BaseEntity {
  productId: string;
  storageId: string;
  quantity: number;
}

export type StockAdjustmentType = "increase" | "decrease";
export type StockAdjustmentReason =
  | "purchase"
  | "return"
  | "correction"
  | "damage"
  | "theft"
  | "expired"
  | "production"
  | "other";

export interface StockAdjustment extends BaseEntity {
  productId: string;
  storageId: string;
  adjustmentType: StockAdjustmentType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reason: StockAdjustmentReason;
  notes?: string | null;
  createdBy?: string | null;
}

export type InventoryTransactionType =
  | "stock_adjustment"
  | "transfer_in"
  | "transfer_out"
  | "sale"
  | "return"
  | "initial_stock";

export interface InventoryTransaction extends BaseEntity {
  productId: string;
  storageId: string;
  transactionType: InventoryTransactionType;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  adjustmentReason?: StockAdjustmentReason | null;
  referenceId?: string | null;
  referenceType?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface StockBatch extends BaseEntity {
  productId: string;
  storageId: string;
  batchNumber: string;
  quantity: number;
  price: number;
  costPrice: number;
  currency: CurrencyCode;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
  notes?: string | null;
  sourcePurchaseOrderId?: string | null;
  sourcePurchaseOrderItemId?: string | null;
}

export interface StockBatchAllocation {
  batchId: string;
  batchNumber: string;
  quantity: number;
  price?: number | null;
  costPrice?: number | null;
  currency?: CurrencyCode | null;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
}

export interface InventoryTransferBatchAllocation {
  sourceBatchId: string;
  destinationBatchId: string;
  batchNumber: string;
  quantity: number;
  price?: number | null;
  costPrice?: number | null;
  currency?: CurrencyCode | null;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
}

export type DiscountType = "percentage" | "fixed_amount";
export type DiscountSource = "product" | "category";

export interface ProductDiscount extends BaseEntity {
  productId: string;
  discountType: DiscountType;
  discountValue: number;
  startsAt: string;
  endsAt: string;
  minStockThreshold?: number | null;
  isActive: boolean;
  createdBy?: string;
}

export interface CategoryDiscount extends BaseEntity {
  categoryId: string;
  discountType: DiscountType;
  discountValue: number;
  startsAt: string;
  endsAt: string;
  minStockThreshold?: number | null;
  isActive: boolean;
  createdBy?: string;
}

export interface ReorderTransferRule extends BaseEntity {
  productId: string;
  sourceStorageId: string;
  destinationStorageId: string;
  minStockLevel: number;
  transferQuantity: number;
  expiresOn?: string | null;
  isIndefinite: boolean;
  lastTriggeredAt?: string | null;
}

export type InventoryTransferTransactionType = "manual" | "automation";

export interface InventoryTransferTransaction extends BaseEntity {
  productId: string;
  sourceStorageId: string;
  destinationStorageId: string;
  quantity: number;
  batchAllocations?: InventoryTransferBatchAllocation[] | null;
  transferType: InventoryTransferTransactionType;
  reorderRuleId?: string | null;
  sourceWorkspaceId?: string | null;
  destinationWorkspaceId?: string | null;
  sourceWorkspaceName?: string | null;
  destinationWorkspaceName?: string | null;
  sourceStorageName?: string | null;
  destinationStorageName?: string | null;
}

export interface Supplier extends BaseEntity {
  businessPartnerId?: string | null;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  defaultCurrency: CurrencyCode;
  notes?: string;
  totalPurchases: number;
  totalSpent: number;
  creditLimit: number;
  isEcommerce?: boolean;
}

export interface Customer extends BaseEntity {
  businessPartnerId?: string | null;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  defaultCurrency: CurrencyCode;
  notes?: string;
  totalOrders: number;
  totalSpent: number;
  outstandingBalance: number;
  creditLimit: number;
  isEcommerce?: boolean;
}

export type RealEstateBusinessPartnerRole = "buyer" | "seller";
export type BusinessPartnerRole =
  | "customer"
  | "supplier"
  | "both"
  | "agent"
  | RealEstateBusinessPartnerRole;
export type AgentType = "driver" | "field_agent";
export type AgentStatus = "active" | "inactive" | "blocked";

export const REAL_ESTATE_BUSINESS_PARTNER_ROLES: readonly RealEstateBusinessPartnerRole[] = [
  "buyer",
  "seller",
];

export function isRealEstateBusinessPartnerRole(
  role: BusinessPartnerRole | string | null | undefined,
): role is RealEstateBusinessPartnerRole {
  return role === "buyer" || role === "seller";
}

export function isAgentBusinessPartnerRole(
  role: BusinessPartnerRole | string | null | undefined,
): role is "agent" {
  return role === "agent";
}

export interface Agent extends BaseEntity {
  businessPartnerId: string;
  imageUrl?: string | null;
  zone: string;
  agentType: AgentType;
  carModel?: string | null;
  plateNumber?: string | null;
  linkedUserId?: string | null;
  status: AgentStatus;
}

export interface AgentFacetInput {
  imageUrl?: string | null;
  zone: string;
  agentType: AgentType;
  carModel?: string | null;
  plateNumber?: string | null;
  linkedUserId?: string | null;
  status: AgentStatus;
}

export type FleetVehicleStatus = "active" | "maintenance" | "inactive";
export type FleetAssignmentStatus = "active" | "ended";

export interface FleetVehicle extends BaseEntity {
  plateNumber: string;
  make?: string | null;
  model: string;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  status: FleetVehicleStatus;
  notes?: string | null;
}

export interface FleetVehicleAssignment extends BaseEntity {
  vehicleId: string;
  agentId: string;
  assignedAt: string;
  endedAt?: string | null;
  status: FleetAssignmentStatus;
  notes?: string | null;
}

export type FleetLocationSessionStatus = "active" | "stopped" | "expired";

export interface FleetLocationSession {
  id: string;
  workspaceId: string;
  agentId: string;
  userId: string;
  status: FleetLocationSessionStatus;
  startedAt: string;
  endedAt?: string | null;
  lastSeenAt?: string | null;
  deviceLabel?: string | null;
}

export interface FleetLocationPoint {
  id?: string;
  workspaceId: string;
  agentId: string;
  sessionId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  recordedAt: string;
  receivedAt?: string;
  isSharing: boolean;
}

export interface BusinessPartner extends BaseEntity {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  defaultCurrency: CurrencyCode;
  notes?: string;
  role: BusinessPartnerRole;
  creditLimit: number;
  customerFacetId?: string | null;
  supplierFacetId?: string | null;
  agentFacetId?: string | null;
  totalSalesOrders: number;
  totalSalesValue: number;
  receivableBalance: number;
  totalPurchaseOrders: number;
  totalPurchaseValue: number;
  payableBalance: number;
  totalLoanCount: number;
  loanOutstandingBalance: number;
  netExposure: number;
  mergedIntoBusinessPartnerId?: string | null;
  isEcommerce?: boolean;
}

export type BusinessPartnerMergeType = "customer_supplier";
export type BusinessPartnerMergeStatus = "pending" | "accepted" | "dismissed";

export interface BusinessPartnerMergeCandidate extends BaseEntity {
  primaryPartnerId: string;
  secondaryPartnerId: string;
  mergeType: BusinessPartnerMergeType;
  reason: string;
  confidence: number;
  status: BusinessPartnerMergeStatus;
}

export type SalesOrderStatus = "draft" | "pending" | "completed" | "cancelled";
export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "received"
  | "completed"
  | "cancelled";
export type OrderType = "sales" | "purchase";
export type OrderPaymentStatus = "unpaid" | "partial" | "paid";
export type OrderPaymentMethod = PaymentMethod | "credit" | "bank_transfer";
export type WorkspaceVisibility = "private" | "public";
export type MarketplaceOrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface ExchangeRateSnapshot {
  pair: string;
  rate: number;
  source: string;
  timestamp: string;
  side?: ExchangeTransactionType;
  priceBasisAmount?: number;
  priceRowId?: string | null;
  priceUpdatedAt?: string | null;
}

export interface SalesExchange {
  id: string;
  saleId: string;
  workspaceId: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  baseAmount: number;
  quoteAmount: number;
  source: string;
  capturedAt: string;
  rateSide: "buy" | "sell" | "mid";
  sourcePriceId?: string | null;
  sourcePriceUpdatedAt?: string | null;
  createdAt: string;
}

export interface OrderLineItem {
  id: string;
  productId: string;
  storageId?: string | null;
  productName: string;
  productSku: string;
  quantity: number;
  lineTotal: number;
  originalCurrency: CurrencyCode;
  originalUnitPrice: number;
  convertedUnitPrice: number;
  settlementCurrency: CurrencyCode;
}

export interface SalesOrderItem extends OrderLineItem {
  costPrice: number;
  convertedCostPrice: number;
  reservedQuantity?: number;
  fulfilledQuantity?: number;
  batchAllocations?: StockBatchAllocation[] | null;
}

export interface PurchaseOrderItem extends OrderLineItem {
  receivedQuantity?: number;
  batchNumber?: string | null;
  batchSalePrice?: number | null;
  batchExpiryDate?: string | null;
  batchManufacturingDate?: string | null;
}

export interface SalesOrder extends BaseEntity {
  orderNumber: string;
  businessPartnerId?: string | null;
  customerId: string;
  customerName: string;
  sourceStorageId?: string | null;
  items: SalesOrderItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: CurrencyCode;
  exchangeRate: number | null;
  exchangeRateSource: string | null;
  exchangeRateTimestamp: string | null;
  exchangeRates?: ExchangeRateSnapshot[] | null;
  status: SalesOrderStatus;
  expectedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  isPaid: boolean;
  paymentStatus: OrderPaymentStatus;
  paidAmount: number;
  balanceAmount: number;
  paidAt?: string | null;
  paymentMethod?: OrderPaymentMethod;
  isInstallmentBased: boolean;
  installmentCount: number;
  installmentFrequency?: InstallmentFrequency | null;
  firstDueDate?: string | null;
  nextDueDate?: string | null;
  reservedAt?: string | null;
  shippingAddress?: string;
  notes?: string;
  isLocked?: boolean;
  sourceChannel?: "manual" | "marketplace" | null;
  marketplaceOrderId?: string | null;
  createdBy?: string | null;
}

export interface PurchaseOrder extends BaseEntity {
  orderNumber: string;
  businessPartnerId?: string | null;
  supplierId: string;
  supplierName: string;
  destinationStorageId?: string | null;
  items: PurchaseOrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  currency: CurrencyCode;
  exchangeRate: number | null;
  exchangeRateSource: string | null;
  exchangeRateTimestamp: string | null;
  exchangeRates?: ExchangeRateSnapshot[] | null;
  status: PurchaseOrderStatus;
  expectedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  isPaid: boolean;
  paymentStatus: OrderPaymentStatus;
  paidAmount: number;
  balanceAmount: number;
  paidAt?: string | null;
  paymentMethod?: OrderPaymentMethod;
  isInstallmentBased: boolean;
  installmentCount: number;
  installmentFrequency?: InstallmentFrequency | null;
  firstDueDate?: string | null;
  nextDueDate?: string | null;
  notes?: string;
  isLocked?: boolean;
  createdBy?: string | null;
}

export interface OrderInstallment extends BaseEntity {
  orderType: OrderType;
  orderId: string;
  installmentNo: number;
  dueDate: string;
  plannedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: InstallmentStatus;
  paidAt?: string | null;
}

export interface MarketplaceOrderItem {
  productId: string;
  storageId?: string | null;
  name: string;
  sku: string;
  unitPrice: number;
  currency: CurrencyCode;
  quantity: number;
  lineTotal: number;
  imageUrl?: string | null;
}

export interface MarketplaceOrder extends BaseEntity {
  orderNumber: string;
  orderSequence: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerNotes?: string | null;
  items: MarketplaceOrderItem[];
  subtotal: number;
  total: number;
  currency: CurrencyCode;
  status: MarketplaceOrderStatus;
  confirmedAt?: string | null;
  processingAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  inventoryDeducted: boolean;
  businessPartnerId?: string | null;
  customerId?: string | null;
  salesOrderId?: string | null;
}

export type TravelAgencyTravelMethod =
  | "bus"
  | "plane"
  | "train"
  | "car"
  | "ship"
  | "hotel"
  | "other";
export type TravelAgencyTripType = "one_way" | "round_trip";
export type TravelAgencyPaymentMethod =
  | "cash"
  | "fib"
  | "qicard"
  | "hawala"
  | "fastpay";
export type TravelAgencyReceiver = "office" | "erbil";
export type TravelAgencySaleStatus = "completed" | "draft";

export interface TravelAgencyTravelPlan {
  method: TravelAgencyTravelMethod;
  departure?: string;
  arrival?: string;
  tripType?: TravelAgencyTripType;
  details?: string;
}

export interface TravelAgencyTourist {
  id: string;
  fullName: string;
  surname: string;
  dateOfBirth?: string;
  travelPlans: TravelAgencyTravelPlan[];
  revenue: number;
  notes?: string;
}

export interface TravelAgencySale extends BaseEntity {
  saleNumber: string;
  saleDate: string;
  status: TravelAgencySaleStatus;
  touristCount: number;
  tourists: TravelAgencyTourist[];
  groupTravelPlans: TravelAgencyTravelPlan[];
  groupName?: string | null;
  groupRevenue: number;
  businessPartnerId?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierCost: number;
  currency: CurrencyCode;
  travelPackages: string[];
  paymentMethod: TravelAgencyPaymentMethod;
  paidAmount: number;
  receiver: TravelAgencyReceiver;
  notes?: string;
  isPaid: boolean;
  paidAt?: string | null;
  isLocked?: boolean;
  // Financial snapshot — locked at save time
  snapshotRevenue?: number | null;
  snapshotCost?: number | null;
  snapshotProfit?: number | null;
  // Exchange rate snapshot
  exchangeRateSnapshot?: {
    pair: string;
    rate: number;
    source: string;
    timestamp: string;
  } | null;
}

export type RealEstateTransactionType = "sell" | "buy" | "rent" | "lease" | "exchange";

export type RealEstatePropertyType = "house" | "apartment" | "land" | "commercial" | "villa" | "office" | "warehouse" | "other";
export type RealEstateTransactionStatus = "active" | "overdue" | "completed";
export type RealEstatePaymentKind =
  | "down_payment"
  | "installment"
  | "manual";

export interface RealEstateTransaction extends BaseEntity {
  transactionNo: string;
  transactionType: RealEstateTransactionType;
  propertyType?: RealEstatePropertyType | null;
  location: string;
  landAreaM2: number;
  currency: CurrencyCode;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  profitAmount: number;
  buyerName: string;
  buyerBusinessPartnerId?: string | null;
  buyerWitnessName?: string | null;
  buyerWitnessAddress?: string | null;
  buyerWitnessPhone?: string | null;
  sellerName: string;
  sellerBusinessPartnerId?: string | null;
  sellerWitnessName?: string | null;
  sellerWitnessAddress?: string | null;
  sellerWitnessPhone?: string | null;
  isInstallmentBased: boolean;
  installmentCount: number;
  installmentFrequency?: InstallmentFrequency | null;
  firstDueDate?: string | null;
  nextDueDate?: string | null;
  status: RealEstateTransactionStatus;
  exchangeRateSnapshot?: ExchangeRateSnapshot[] | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface RealEstateInstallment extends BaseEntity {
  transactionId: string;
  installmentNo: number;
  dueDate: string;
  plannedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: InstallmentStatus;
  paidAt?: string | null;
}

export interface RealEstatePayment extends BaseEntity {
  transactionId: string;
  installmentId?: string | null;
  amount: number;
  paymentMethod: WorkspacePaymentMethod;
  paymentKind: RealEstatePaymentKind;
  paidAt: string;
  note?: string | null;
  createdBy?: string | null;
}

export type ExchangeTransactionType = "buy" | "sell";
export type ExchangeFeeType = "fixed" | "percentage";
export type ExchangeFeeRuleTransactionScope = "buy" | "sell" | "both";
export type ExchangeAcquisitionRateSource = "last_buy" | "manual";
export type ExchangeSafeMovementType =
  | "opening_balance"
  | "adjustment"
  | "exchange_in"
  | "exchange_out";
export type ExchangeSafeMovementSourceType =
  | "opening_balance"
  | "adjustment"
  | "exchange_transaction";
export type ExchangePaymentMethod =
  | "cash"
  | "fib"
  | "qicard"
  | "zaincash"
  | "fastpay";

export interface ExchangeFeeRuleSnapshot {
  id: string;
  name: string;
  transactionScope: ExchangeFeeRuleTransactionScope;
  feeType: ExchangeFeeType;
  currency: CurrencyCode;
  value: number;
  customerGivesBasisAmount: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isLocked: boolean;
}

export interface ExchangeFeeRule extends BaseEntity {
  name: string;
  transactionScope: ExchangeFeeRuleTransactionScope;
  feeType: ExchangeFeeType;
  currency: CurrencyCode;
  value: number;
  customerGivesBasisAmount: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isActive: boolean;
  isLocked: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

export interface ExchangePairPrice extends BaseEntity {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  buyPrice: number;
  sellPrice: number;
  priceBasisAmount: number;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface ExchangeTransaction extends BaseEntity {
  transactionNo: string;
  transactionType: ExchangeTransactionType;
  transactionDate: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  customerGivesAmount: number;
  customerReceivesAmount: number;
  exchangeRateUsed: number;
  exchangeRateSource: string;
  exchangeRateManuallyEdited: boolean;
  marketRateSnapshot: ExchangeRateSnapshot[];
  feeRuleId?: string | null;
  feeRuleSnapshot?: ExchangeFeeRuleSnapshot | null;
  feeType?: ExchangeFeeType | null;
  feeCurrency?: CurrencyCode | null;
  originalFeeValue?: number | null;
  finalFeeValue: number;
  feeAmount: number;
  feeEdited: boolean;
  safeId?: string | null;
  safeNameSnapshot?: string | null;
  acquisitionRate?: number | null;
  acquisitionRateSource?: ExchangeAcquisitionRateSource | null;
  acquisitionRateSnapshot?: ExchangeRateSnapshot[] | null;
  profitAmount?: number | null;
  profitCurrency?: CurrencyCode | null;
  paymentMethod: ExchangePaymentMethod;
  employeeUserId?: string | null;
  employeeName?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  isReversed: boolean;
  reversalTransactionId?: string | null;
  reversedTransactionId?: string | null;
}

export interface ExchangeSafe extends BaseEntity {
  name: string;
  isActive: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

export interface ExchangeSafeBalance extends BaseEntity {
  safeId: string;
  currency: CurrencyCode;
  balanceAmount: number;
}

export interface ExchangeSafeMovement extends BaseEntity {
  safeId: string;
  safeNameSnapshot: string;
  currency: CurrencyCode;
  movementType: ExchangeSafeMovementType;
  sourceType: ExchangeSafeMovementSourceType;
  sourceId?: string | null;
  deltaAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  notes?: string | null;
  createdBy?: string | null;
}

export type ClinicalAppointmentStatus =
  | 'draft'
  | 'booked'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type ClinicalConfirmationMethod =
  | 'phone'
  | 'sms'
  | 'whatsapp'
  | 'email'
  | 'other';

export type ClinicalAppointmentPriority = 'normal' | 'urgent' | 'emergency';

export type ClinicalAppointmentPaymentStatus = 'no_fee' | 'unpaid' | 'partial' | 'paid';

export type ClinicalAppointmentType =
  | 'consultation'
  | 'follow_up'
  | 'emergency'
  | 'checkup'
  | 'procedure'
  | 'treatment';

export type ClinicalPatientType = 'new' | 'existing';

export type ClinicalPresetCategory = 'reason_for_visit' | 'appointment_type' | 'registry_type';

export type ClinicalRegistryType = 'medical' | 'beauty';

export interface ClinicalPreset extends BaseEntity {
  category: ClinicalPresetCategory;
  name: string;
  consultationFee: number;
  sortOrder: number;
  isActive: boolean;
  createdBy?: string | null;
}

export type ManualEntryTemplateStatus = 'active' | 'inactive';

export interface ManualEntryTemplateRow {
  id: string;
  label: string;
  sortOrder: number;
}

export interface ManualEntryTemplate extends BaseEntity {
  name: string;
  headerName?: string;
  headerPhone1?: string;
  headerPhone2?: string;
  detailsLabel1?: string;
  detailsLabel2?: string;
  detailsLabel3?: string;
  rows: ManualEntryTemplateRow[];
  status: ManualEntryTemplateStatus;
  createdBy?: string | null;
}

export interface ManualEntry {
  id: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  rows: ManualEntryTemplateRow[];
  data: Record<string, string[]>;
  detailValues: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalPatient extends BaseEntity {
  name: string;
  phone?: string | null;
  email?: string | null;
  isNewPatient: boolean;
  notes?: string | null;
  createdBy?: string | null;
  birthYear?: number | null;
}

export interface ClinicalAppointment extends BaseEntity {
  patientId: string;
  patientName: string;
  patientPhone?: string | null;
  isNewPatient: boolean;
  appointmentDate: string;
  startTime: string;
  appointmentType: ClinicalAppointmentType;
  reasonForVisit?: string | null;
  serviceProcedure?: string | null;
  consultationFee: number;
  estimatedPrice: number;
  currency: CurrencyCode;
  paidAmount: number;
  paymentStatus: ClinicalAppointmentPaymentStatus;
  status: ClinicalAppointmentStatus;
  confirmationMethod?: ClinicalConfirmationMethod | null;
  priority: ClinicalAppointmentPriority;
  internalNotes?: string | null;
  createdBy?: string | null;
}

export interface ClinicalAttachment extends BaseEntity {
  appointmentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  r2Path?: string | null;
  localPath?: string | null;
  createdBy?: string | null;
}

export interface Employee extends BaseEntity {
  name: string;
  email?: string;
  phone?: string;
  gender?: "male" | "female" | "other";
  role: string; // Internal labeling role. Format: "Category:Role" (e.g. "Management:Manager", "Staff:Salesman")
  location?: string;
  joiningDate: string;
  salary: number;
  salaryCurrency: CurrencyCode;
  hasDividends?: boolean;
  dividendType?: "fixed" | "percentage";
  dividendAmount?: number;
  dividendCurrency?: CurrencyCode;
  salaryPayday?: number;
  dividendPayday?: number;
  isFired?: boolean;
  linkedUserId?: string;
}

export type BudgetStatus = "pending" | "snoozed" | "paid";
export type ExpenseRecurrence = "monthly" | "one_time";

export interface BudgetSettings extends BaseEntity {
  startMonth: string;
}

export interface BudgetAllocation extends BaseEntity {
  month: string;
  currency: CurrencyCode;
  allocationType?: "fixed" | "percentage";
  allocationValue?: number;
}

export interface ExpenseSeries extends BaseEntity {
  name: string;
  amount: number;
  currency: CurrencyCode;
  dueDay: number;
  recurrence: ExpenseRecurrence;
  startMonth: string;
  endMonth?: string | null;
  category?: string | null;
  subcategory?: string | null;
}

export interface ExpenseItem extends BaseEntity {
  seriesId: string;
  month: string;
  dueDate: string;
  amount: number;
  currency: CurrencyCode;
  status: BudgetStatus;
  snoozedUntil?: string | null;
  snoozedIndefinite?: boolean;
  snoozeCount?: number;
  paidAt?: string | null;
  isLocked?: boolean;
}

export interface PayrollStatus extends BaseEntity {
  employeeId: string;
  month: string;
  status: BudgetStatus;
  snoozedUntil?: string | null;
  snoozedIndefinite?: boolean;
  snoozeCount?: number;
  paidAt?: string | null;
  isLocked?: boolean;
}

export interface DividendStatus extends BaseEntity {
  employeeId: string;
  month: string;
  status: BudgetStatus;
  snoozedUntil?: string | null;
  snoozedIndefinite?: boolean;
  snoozeCount?: number;
  paidAt?: string | null;
  isLocked?: boolean;
}

// Order Items (Unified logic for base items, but separated for type safety)

// Legacy OrderItem for Invoice compatibility (to be refactored or kept for snapshots)
export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: CurrencyCode;
}

export type InvoiceStatus = "sent" | "paid" | "overdue" | "cancelled" | "draft";

export interface Invoice extends BaseEntity {
  invoiceid: string;
  orderId?: string;
  customerId?: string;
  status?: InvoiceStatus;
  // Total amount in settlement currency
  totalAmount: number;
  settlementCurrency: CurrencyCode;
  // Print-to-Invoice tracking
  origin?:
    | "pos"
    | "instant_pos"
    | "revenue"
    | "inventory"
    | "manual"
    | "exchange"
    | "accounting"
    | "loans"
    | "Loans"
    | "real_estate"
    | "sales_order"
    | "travel_agency"
    | "clinical_appointment"
    | "upload";
  /** @deprecated Use cashierName for the name string. createdBy might map to system UUID. */
  createdBy?: string;
  cashierName?: string;
  createdByName?: string;
  sequenceId?: number;
  printFormat?: "a4" | "receipt";
  // PDF Storage (R2)
  r2PathA4?: string;
  r2PathReceipt?: string;
  // Local PDF Storage (AppData)
  localPathA4?: string;
  localPathReceipt?: string;
  // Local PDF Blob (pending upload)
  pdfBlobA4?: Blob;
  pdfBlobReceipt?: Blob;
  fileSize?: number;
  fileMimeType?: string | null;
}

export interface Sale extends BaseEntity {
  cashierId: string;
  totalAmount: number;
  originalTotalAmount?: number;
  returnedAmount?: number;
  returnStatus?: "none" | "partial" | "full";
  settlementCurrency: CurrencyCode;
  origin: string;
  payment_method?: PaymentMethod;
  // Sequential ID (generated by server)
  sequenceId?: number;
  // System Verification (offline-first, immutable)
  systemVerified: boolean;
  systemReviewStatus: "approved" | "flagged" | "inconsistent";
  systemReviewReason: string | null;
  isReturned?: boolean;
  notes?: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  storageId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  costPrice: number;
  convertedCostPrice: number;
  originalCurrency: CurrencyCode;
  originalUnitPrice: number;
  convertedUnitPrice: number;
  settlementCurrency: CurrencyCode;
  negotiatedPrice?: number;
  // Immutable inventory snapshot at checkout
  inventorySnapshot: number;
  batchAllocations?: StockBatchAllocation[] | null;
  originalBatchAllocations?: StockBatchAllocation[] | null;
  returnedQuantity?: number;
}

export interface SaleReturn extends BaseEntity {
  saleId: string;
  reason: string;
  status: "posted" | "voided";
  refundMethod?: string | null;
  refundAmount: number;
  returnedBy?: string | null;
  returnedAt: string;
  source: "app" | "legacy_backfill" | "system";
}

export interface SaleReturnItem extends BaseEntity {
  returnId: string;
  saleId: string;
  saleItemId: string;
  quantity: number;
  unitRefundAmount: number;
  refundAmount: number;
  restoredStorageId?: string | null;
  restoredBatchAllocations?: StockBatchAllocation[] | null;
}

export type LoanSource = "pos" | "manual";
export type LoanCategory = "standard" | "simple";
export type LoanDirection = "lent" | "borrowed";
export type LoanStatus = "active" | "overdue" | "completed";
export type InstallmentStatus = "unpaid" | "partial" | "paid" | "overdue";
export type InstallmentFrequency = "weekly" | "biweekly" | "monthly";
export type LoanLinkedPartyType = "business_partner";

export interface Loan extends BaseEntity {
  saleId?: string | null;
  loanNo: string;
  source: LoanSource;
  loanCategory?: LoanCategory;
  direction?: LoanDirection;
  linkedPartyType?: LoanLinkedPartyType | null;
  linkedPartyId?: string | null;
  linkedPartyName?: string | null;
  borrowerName: string;
  borrowerPhone: string;
  borrowerAddress: string;
  borrowerNationalId: string;
  principalAmount: number;
  totalPaidAmount: number;
  balanceAmount: number;
  settlementCurrency: CurrencyCode;
  exchangeRateSnapshot?: ExchangeRateSnapshot[] | null;
  installmentCount: number;
  installmentFrequency: InstallmentFrequency;
  firstDueDate: string | null;
  nextDueDate?: string | null;
  overdueReminderSnoozedAt?: string | null;
  overdueReminderSnoozedForDueDate?: string | null;
  status: LoanStatus;
  notes?: string;
  createdBy?: string;
}

export interface LoanInstallment extends BaseEntity {
  loanId: string;
  installmentNo: number;
  dueDate: string | null;
  plannedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: InstallmentStatus;
  paidAt?: string | null;
}

export interface LoanPayment extends BaseEntity {
  loanId: string;
  amount: number;
  paymentMethod: LoanPaymentMethod;
  paidAt: string;
  note?: string;
  createdBy?: string;
}

export type PaymentTransactionSourceModule =
  | "loans"
  | "orders"
  | "budget"
  | "real_estate"
  | "clinical_appointments"
  | "currency_exchange"
  | "payments";
export type PaymentTransactionSourceType =
  | "loan_origination"
  | "loan_payment"
  | "simple_loan"
  | "loan_installment"
  | "real_estate_payment"
  | "real_estate_installment"
  | "real_estate_commission"
  | "clinical_appointment"
  | "sales_order"
  | "purchase_order"
  | "expense_item"
  | "payroll_status"
  | "direct_transaction"
  | "exchange_transaction";
export type PaymentTransactionDirection = "incoming" | "outgoing";

export interface PaymentTransaction extends BaseEntity {
  sourceModule: PaymentTransactionSourceModule;
  sourceType: PaymentTransactionSourceType;
  sourceRecordId: string;
  sourceSubrecordId?: string | null;
  direction: PaymentTransactionDirection;
  amount: number;
  currency: CurrencyCode;
  paymentMethod: WorkspacePaymentMethod;
  paidAt: string;
  counterpartyName?: string | null;
  referenceLabel?: string | null;
  note?: string | null;
  createdBy?: string | null;
  reversalOfTransactionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentObligation {
  id: string;
  workspaceId: string;
  sourceModule: PaymentTransactionSourceModule;
  sourceType: PaymentTransactionSourceType;
  sourceRecordId: string;
  sourceSubrecordId?: string | null;
  direction: PaymentTransactionDirection;
  amount: number;
  currency: CurrencyCode;
  dueDate: string;
  counterpartyName?: string | null;
  referenceLabel?: string | null;
  title: string;
  subtitle?: string | null;
  status: "open" | "overdue";
  routePath: string;
  metadata?: Record<string, unknown> | null;
}

// Sync Queue Item for tracking pending changes
export interface SyncQueueItem {
  id: string;
  entityType:
    | "products"
    | "product_barcodes"
    | "inventory"
    | "inventory_transactions"
    | "stock_batches"
    | "reorder_transfer_rules"
    | "inventory_transfer_transactions"
    | "invoices"
    | "users"
    | "sales"
    | "categories"
    | "product_discounts"
    | "category_discounts"
    | "storages"
    | "employees"
    | "workspace_contacts"
    | "loans"
    | "loan_installments"
    | "loan_payments"
    | "payment_transactions"
    | "budget_settings"
    | "budget_allocations"
    | "expense_series"
    | "expense_items"
    | "payroll_statuses"
    | "dividend_statuses"
    | "customers"
    | "suppliers"
    | "agents"
    | "fleet_vehicles"
    | "fleet_vehicle_assignments"
    | "business_partners"
    | "business_partner_merge_candidates"
    | "sales_orders"
    | "purchase_orders"
    | "order_installments"
    | "travel_agency_sales"
    | "real_estate_transactions"
    | "real_estate_installments"
    | "real_estate_payments"
    | "exchange_pair_prices"
    | "exchange_transactions"
    | "exchange_fee_rules"
    | "fx_safes"
    | "fx_safe_balances"
    | "fx_safe_movements"
    | "clinical_appointments"
    | "clinical_patients"
    | "clinical_attachments"
    | "clinical_presets";
  entityId: string;
  operation: "create" | "update" | "delete";
  data: Record<string, unknown>;
  timestamp: string;
  retryCount: number;
}

// Offline Mutation for manual sync queue
export type MutationStatus = "pending" | "syncing" | "failed" | "synced";

export interface Workspace extends BaseEntity {
  name: string;
  code: string;
  plan?: WorkspacePlan;
  data_mode: WorkspaceDataMode;
  is_configured?: boolean;
  // Module toggles
  pos?: boolean;
  instant_pos?: boolean;
  sales_history?: boolean;
  crm?: boolean;
  travel_agency?: boolean;
  real_estate?: boolean;
  currency_exchange?: boolean;
  agents?: boolean;
  clinical_appointments?: boolean;
  loans?: boolean;
  installments?: boolean;
  net_revenue?: boolean;
  budget?: boolean;
  monthly_comparison?: boolean;
  team_performance?: boolean;
  products?: boolean;
  discounts?: boolean;
  storages?: boolean;
  inventory_transfer?: boolean;
  inventory_transactions?: boolean;
  stock_adjustments?: boolean;
  invoices_history?: boolean;
  hr?: boolean;
  ecommerce?: boolean;
  // Settings
  default_currency: CurrencyCode;
  iqd_display_preference: IQDDisplayPreference;
  locked_workspace: boolean;
  allow_whatsapp?: boolean;
  kds_enabled?: boolean;
  logo_url?: string | null;
  coordination?: string | null;
  syncStatus: SyncStatus;
  max_discount_percent?: number;
  print_lang?: "auto" | "en" | "ar" | "ku";
  print_qr?: boolean;
  receipt_template?: "primary" | "modern";
  a4_template?: "primary" | "modern";
  thermal_printing?: boolean;
  subscription_expires_at?: string | null;
  upload_limit_mb?: number | null;
  visibility?: WorkspaceVisibility;
  store_slug?: string | null;
  store_description?: string | null;
}

export interface WorkspaceContact extends Omit<BaseEntity, "isDeleted"> {
  type: "phone" | "email" | "address";
  value: string;
  label?: string;
  isPrimary: boolean;
}

export interface OfflineMutation {
  id: string;
  workspaceId: string;
  entityType:
    | "products"
    | "product_barcodes"
    | "inventory"
    | "inventory_transactions"
    | "stock_batches"
    | "reorder_transfer_rules"
    | "inventory_transfer_transactions"
    | "invoices"
    | "users"
    | "sales"
    | "categories"
    | "product_discounts"
    | "category_discounts"
    | "workspaces"
    | "workspace_branches"
    | "storages"
    | "employees"
    | "workspace_contacts"
    | "loans"
    | "loan_installments"
    | "loan_payments"
    | "payment_transactions"
    | "budget_settings"
    | "budget_allocations"
    | "expense_series"
    | "expense_items"
    | "payroll_statuses"
    | "dividend_statuses"
    | "customers"
    | "suppliers"
    | "agents"
    | "fleet_vehicles"
    | "fleet_vehicle_assignments"
    | "business_partners"
    | "business_partner_merge_candidates"
    | "sales_orders"
    | "purchase_orders"
    | "order_installments"
    | "travel_agency_sales"
    | "real_estate_transactions"
    | "real_estate_installments"
    | "real_estate_payments"
    | "exchange_pair_prices"
    | "exchange_transactions"
    | "exchange_fee_rules"
    | "fx_safes"
    | "fx_safe_balances"
    | "fx_safe_movements"
    | "clinical_appointments"
    | "clinical_patients"
    | "clinical_attachments"
    | "clinical_presets";
  entityId: string;
  operation: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  createdAt: string;
  status: MutationStatus;
  error?: string;
}

export interface AppSetting {
  key: string;
  value: string;
}

export interface WorkspacePermission {
  id: string;
  workspaceId: string;
  userUuid: string;
  key: string;
  module: string;
}

// Type guards
export function isProduct(entity: BaseEntity): entity is Product {
  return "sku" in entity && "price" in entity && "currency" in entity;
}

export function isInvoice(entity: BaseEntity): entity is Invoice {
  return "invoiceid" in entity && "items" in entity;
}
