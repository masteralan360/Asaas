import Dexie, {
  type DBCore,
  type DBCoreMutateRequest,
  type DBCoreMutateResponse,
  type DBCoreTable,
  type EntityTable,
  type Transaction,
} from "dexie";
import type {
  Product,
  ProductBarcode,
  PriceBook,
  PriceBookItem,
  Category,
  Unit,
  Invoice,
  InvoiceVersion,
  User,
  SyncQueueItem,
  Sale,
  SalesExchange,
  SaleItem,
  SaleReturn,
  SaleReturnItem,
  SaleProductExchange,
  OrderReturn,
  OrderReturnItem,
  OfflineMutation,
  Workspace,
  AppSetting,
  Storage,
  Inventory,
  InventoryTransaction,
  StockBatch,
  InventoryTransferTransaction,
  ReorderTransferRule,
  Supplier,
  Customer,
  Agent,
  AgentExcludedCategory,
  FleetVehicle,
  FleetVehicleAssignment,
  BusinessPartner,
  BusinessPartnerMergeCandidate,
  Employee,
  WorkspaceContact,
  Loan,
  LoanInstallment,
  LoanPayment,
  PaymentTransaction,
  BudgetSettings,
  BudgetAllocation,
  ExpenseSeries,
  ExpenseItem,
  PayrollStatus,
  DividendStatus,
  ProductDiscount,
  CategoryDiscount,
  SalesOrder,
  PurchaseOrder,
  OrderInstallment,
  TravelAgencySale,
  RealEstateTransaction,
  RealEstateInstallment,
  RealEstatePayment,
  ActivityCatalogItem,
  ActivityTransaction,
  ActivityTransactionLine,
  ExchangePairPrice,
  ExchangeTransaction,
  ExchangeFeeRule,
  ExchangeSafe,
  ExchangeSafeBalance,
  ExchangeSafeMovement,
  ClinicalAppointment,
  ClinicalPatient,
  ClinicalAttachment,
  ClinicalPreset,
  Profile,
  LocalAccountCredential,
  WorkspacePermission,
  ManualEntryTemplate,
  ManualEntry,
} from "./models";
import { isLocalWorkspaceMode } from "@/workspace/workspaceMode";
import { normalizeProductSku } from "./productSku";
import { getActiveBusinessWorkspaceId } from "@/lib/network";
import {
  LOCAL_MODE_SQLITE_TABLES,
  commitLocalModeSqliteMutations,
  queueLocalModeSqliteDelete,
  queueLocalModeSqliteUpsert,
  type LocalModeSqliteMutation,
  type LocalModeSqliteTableName,
} from "./localModeSqlite";

const STOCK_ADJUSTMENT_REASONS = [
  "purchase",
  "return",
  "correction",
  "damage",
  "theft",
  "expired",
  "production",
  "other",
] as const;

const SUPPORTED_CURRENCIES = ["usd", "eur", "iqd", "try"] as const;

interface LocalModeSqliteTransactionContext {
  mutations: LocalModeSqliteMutation[];
}

const localModeSqliteTransactions = new WeakMap<
  object,
  LocalModeSqliteTransactionContext
>();

function isMirroredSqliteTable(
  tableName: string,
): tableName is LocalModeSqliteTableName {
  return (LOCAL_MODE_SQLITE_TABLES as readonly string[]).includes(tableName);
}

function getMutationWorkspaceId(
  tableName: LocalModeSqliteTableName,
  row: Record<string, unknown>,
) {
  if (tableName === "workspaces") {
    return typeof row.id === "string" ? row.id : null;
  }
  if (tableName === "profiles") {
    return typeof row.currentWorkspaceId === "string"
      ? row.currentWorkspaceId
      : typeof row.workspaceId === "string"
        ? row.workspaceId
        : null;
  }
  if (typeof row.workspaceId === "string") {
    return row.workspaceId;
  }
  if (tableName === "sale_items") {
    return getActiveBusinessWorkspaceId();
  }
  return null;
}

function readRowsBeforeMutation(
  table: DBCoreTable,
  request: DBCoreMutateRequest,
): Promise<Record<string, unknown>[]> {
  if (request.type === "add" || request.type === "put") {
    return Dexie.Promise.resolve(
      request.values as Record<string, unknown>[],
    );
  }
  if (request.type === "delete") {
    return table.getMany({
      trans: request.trans,
      keys: request.keys,
    }).then(
      (rows) => rows.filter(Boolean) as Record<string, unknown>[],
    );
  }

  return table.query({
    trans: request.trans,
    values: true,
    query: {
      index: table.schema.primaryKey,
      range: request.range,
    },
  }).then(({ result }) => result as Record<string, unknown>[]);
}

function successfulMutationRows(
  request: DBCoreMutateRequest,
  response: DBCoreMutateResponse,
  rows: readonly Record<string, unknown>[],
) {
  if (request.type === "deleteRange") {
    return response.numFailures === 0 ? rows : [];
  }
  return rows.filter(
    (_row, index) => !Object.prototype.hasOwnProperty.call(response.failures, index),
  );
}

function buildSqliteMutations(
  tableName: LocalModeSqliteTableName,
  request: DBCoreMutateRequest,
  rows: readonly Record<string, unknown>[],
): LocalModeSqliteMutation[] {
  const type = request.type === "add" || request.type === "put"
    ? "upsert"
    : "delete";
  return rows.map((row) => ({
    type,
    tableName,
    row,
    workspaceId: getMutationWorkspaceId(tableName, row),
  }));
}

function getStringValue(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getNullableStringValue(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

function getNumberValue(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBooleanValue(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function getCurrencyCodeValue(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: (typeof SUPPORTED_CURRENCIES)[number],
) {
  const value = getStringValue(record, key)?.toLowerCase();
  return value &&
    SUPPORTED_CURRENCIES.includes(
      value as (typeof SUPPORTED_CURRENCIES)[number],
    )
    ? (value as (typeof SUPPORTED_CURRENCIES)[number])
    : fallback;
}

function getAdjustmentReason(record: Record<string, unknown> | undefined) {
  const reason =
    getStringValue(record, "reason") ??
    getStringValue(record, "adjustmentReason");
  return reason &&
    STOCK_ADJUSTMENT_REASONS.includes(
      reason as (typeof STOCK_ADJUSTMENT_REASONS)[number],
    )
    ? reason
    : "correction";
}

function buildInventoryTransactionFromStockAdjustmentRecord(
  adjustmentRecord: Record<string, unknown>,
  existingTransactionRecord?: Record<string, unknown>,
) {
  const id = getStringValue(adjustmentRecord, "id");
  const workspaceId =
    getStringValue(adjustmentRecord, "workspaceId") ??
    getStringValue(existingTransactionRecord, "workspaceId");
  const productId =
    getStringValue(adjustmentRecord, "productId") ??
    getStringValue(existingTransactionRecord, "productId");
  const storageId =
    getStringValue(adjustmentRecord, "storageId") ??
    getStringValue(existingTransactionRecord, "storageId");

  if (!id || !workspaceId || !productId || !storageId) {
    return null;
  }

  const quantity = Math.max(
    0,
    getNumberValue(
      adjustmentRecord,
      "quantity",
      Math.abs(getNumberValue(existingTransactionRecord, "quantityDelta", 0)),
    ),
  );
  const adjustmentType = getStringValue(adjustmentRecord, "adjustmentType");
  const quantityDelta = adjustmentType === "decrease" ? -quantity : quantity;
  const createdAt =
    getStringValue(adjustmentRecord, "createdAt") ??
    getStringValue(existingTransactionRecord, "createdAt") ??
    new Date().toISOString();
  const updatedAt =
    getStringValue(adjustmentRecord, "updatedAt") ??
    getStringValue(existingTransactionRecord, "updatedAt") ??
    createdAt;
  const version = Math.max(
    getNumberValue(existingTransactionRecord, "version", 1),
    getNumberValue(adjustmentRecord, "version", 1),
  );
  const previousQuantity = getNumberValue(
    adjustmentRecord,
    "previousQuantity",
    getNumberValue(existingTransactionRecord, "previousQuantity", 0),
  );

  return {
    ...(existingTransactionRecord ?? {}),
    id,
    workspaceId,
    productId,
    storageId,
    transactionType: "stock_adjustment",
    quantityDelta,
    previousQuantity,
    newQuantity: getNumberValue(
      adjustmentRecord,
      "newQuantity",
      getNumberValue(
        existingTransactionRecord,
        "newQuantity",
        previousQuantity + quantityDelta,
      ),
    ),
    adjustmentReason: getAdjustmentReason(adjustmentRecord),
    referenceId: id,
    referenceType: "stock_adjustment",
    notes:
      getNullableStringValue(adjustmentRecord, "notes") ??
      getNullableStringValue(existingTransactionRecord, "notes"),
    createdBy:
      getNullableStringValue(adjustmentRecord, "createdBy") ??
      getNullableStringValue(existingTransactionRecord, "createdBy"),
    createdAt,
    updatedAt,
    version,
    isDeleted: getBooleanValue(
      adjustmentRecord,
      "isDeleted",
      getBooleanValue(existingTransactionRecord, "isDeleted", false),
    ),
    syncStatus:
      getStringValue(adjustmentRecord, "syncStatus") ??
      getStringValue(existingTransactionRecord, "syncStatus") ??
      "synced",
    lastSyncedAt:
      getNullableStringValue(adjustmentRecord, "lastSyncedAt") ??
      getNullableStringValue(existingTransactionRecord, "lastSyncedAt") ??
      null,
  };
}

function normalizeStockAdjustmentInventoryTransactionRecord(
  transactionRecord: Record<string, unknown>,
  canonicalId?: string | null,
) {
  const id = canonicalId ?? getStringValue(transactionRecord, "id");
  const workspaceId = getStringValue(transactionRecord, "workspaceId");
  const productId = getStringValue(transactionRecord, "productId");
  const storageId = getStringValue(transactionRecord, "storageId");
  const quantityDelta = getNumberValue(transactionRecord, "quantityDelta", 0);

  if (!id || !workspaceId || !productId || !storageId || quantityDelta === 0) {
    return null;
  }

  const createdAt =
    getStringValue(transactionRecord, "createdAt") ?? new Date().toISOString();
  const previousQuantity = getNumberValue(
    transactionRecord,
    "previousQuantity",
    0,
  );

  return {
    ...transactionRecord,
    id,
    workspaceId,
    productId,
    storageId,
    transactionType: "stock_adjustment",
    quantityDelta,
    previousQuantity,
    newQuantity: getNumberValue(
      transactionRecord,
      "newQuantity",
      previousQuantity + quantityDelta,
    ),
    adjustmentReason: getAdjustmentReason(transactionRecord),
    referenceId: id,
    referenceType: "stock_adjustment",
    notes: getNullableStringValue(transactionRecord, "notes"),
    createdBy: getNullableStringValue(transactionRecord, "createdBy"),
    createdAt,
    updatedAt: getStringValue(transactionRecord, "updatedAt") ?? createdAt,
    version: getNumberValue(transactionRecord, "version", 1),
    isDeleted: getBooleanValue(transactionRecord, "isDeleted", false),
    syncStatus: getStringValue(transactionRecord, "syncStatus") ?? "synced",
    lastSyncedAt:
      getNullableStringValue(transactionRecord, "lastSyncedAt") ?? null,
  };
}

// Atlas Database using Dexie.js for IndexedDB
export class AtlasDatabase extends Dexie {
  products!: EntityTable<Product, "id">;
  product_barcodes!: EntityTable<ProductBarcode, "id">;
  price_books!: EntityTable<PriceBook, "id">;
  price_book_items!: EntityTable<PriceBookItem, "id">;
  categories!: EntityTable<Category, "id">;
  units!: EntityTable<Unit, "id">;
  invoices!: EntityTable<Invoice, "id">;
  invoice_versions!: EntityTable<InvoiceVersion, "id">;
  users!: EntityTable<User, "id">;
  sales!: EntityTable<Sale, "id">;
  sales_exchange!: EntityTable<SalesExchange, "id">;
  sale_items!: EntityTable<SaleItem, "id">;
  sale_returns!: EntityTable<SaleReturn, "id">;
  sale_return_items!: EntityTable<SaleReturnItem, "id">;
  sale_product_exchanges!: EntityTable<SaleProductExchange, "id">;
  order_returns!: EntityTable<OrderReturn, "id">;
  order_return_items!: EntityTable<OrderReturnItem, "id">;
  workspaces!: EntityTable<Workspace, "id">;
  storages!: EntityTable<Storage, "id">;
  inventory!: EntityTable<Inventory, "id">;
  inventory_transactions!: EntityTable<InventoryTransaction, "id">;
  stock_batches!: EntityTable<StockBatch, "id">;
  product_discounts!: EntityTable<ProductDiscount, "id">;
  category_discounts!: EntityTable<CategoryDiscount, "id">;
  inventory_transfer_transactions!: EntityTable<
    InventoryTransferTransaction,
    "id"
  >;
  reorder_transfer_rules!: EntityTable<ReorderTransferRule, "id">;
  suppliers!: EntityTable<Supplier, "id">;
  customers!: EntityTable<Customer, "id">;
  agents!: EntityTable<Agent, "id">;
  agent_excluded_categories!: EntityTable<AgentExcludedCategory, "id">;
  fleet_vehicles!: EntityTable<FleetVehicle, "id">;
  fleet_vehicle_assignments!: EntityTable<FleetVehicleAssignment, "id">;
  business_partners!: EntityTable<BusinessPartner, "id">;
  business_partner_merge_candidates!: EntityTable<
    BusinessPartnerMergeCandidate,
    "id"
  >;
  employees!: EntityTable<Employee, "id">;
  budget_settings!: EntityTable<BudgetSettings, "id">;
  budget_allocations!: EntityTable<BudgetAllocation, "id">;
  expense_series!: EntityTable<ExpenseSeries, "id">;
  expense_items!: EntityTable<ExpenseItem, "id">;
  payroll_statuses!: EntityTable<PayrollStatus, "id">;
  dividend_statuses!: EntityTable<DividendStatus, "id">;
  syncQueue!: EntityTable<SyncQueueItem, "id">;
  offline_mutations!: EntityTable<OfflineMutation, "id">;
  app_settings!: EntityTable<AppSetting, "key">;
  workspace_contacts!: EntityTable<WorkspaceContact, "id">;
  loans!: EntityTable<Loan, "id">;
  loan_installments!: EntityTable<LoanInstallment, "id">;
  loan_payments!: EntityTable<LoanPayment, "id">;
  payment_transactions!: EntityTable<PaymentTransaction, "id">;
  sales_orders!: EntityTable<SalesOrder, "id">;
  purchase_orders!: EntityTable<PurchaseOrder, "id">;
  order_installments!: EntityTable<OrderInstallment, "id">;
  travel_agency_sales!: EntityTable<TravelAgencySale, "id">;
  real_estate_transactions!: EntityTable<RealEstateTransaction, "id">;
  real_estate_installments!: EntityTable<RealEstateInstallment, "id">;
  real_estate_payments!: EntityTable<RealEstatePayment, "id">;
  activity_catalog!: EntityTable<ActivityCatalogItem, "id">;
  activity_transactions!: EntityTable<ActivityTransaction, "id">;
  activity_transaction_lines!: EntityTable<ActivityTransactionLine, "id">;
  exchange_pair_prices!: EntityTable<ExchangePairPrice, "id">;
  exchange_transactions!: EntityTable<ExchangeTransaction, "id">;
  exchange_fee_rules!: EntityTable<ExchangeFeeRule, "id">;
  fx_safes!: EntityTable<ExchangeSafe, "id">;
  fx_safe_balances!: EntityTable<ExchangeSafeBalance, "id">;
  fx_safe_movements!: EntityTable<ExchangeSafeMovement, "id">;
  clinical_appointments!: EntityTable<ClinicalAppointment, "id">;
  clinical_patients!: EntityTable<ClinicalPatient, "id">;
  clinical_attachments!: EntityTable<ClinicalAttachment, "id">;
  clinical_presets!: EntityTable<ClinicalPreset, "id">;
  profiles!: EntityTable<Profile, "id">;
  local_account_credentials!: EntityTable<LocalAccountCredential, "id">;
  workspace_permissions!: EntityTable<WorkspacePermission, "id">;
  manual_entry_templates!: EntityTable<ManualEntryTemplate, "id">;
  manual_entries!: EntityTable<ManualEntry, "id">;

  constructor(databaseName = "AtlasDatabase") {
    super(databaseName);

    // Version 38 combines two parallel migration intents: invoice PDF metadata
    // indexes and the budget/expense/payroll/dividend local tables. Keep this
    // as a single declaration because Dexie versions must be unique, while the
    // upgrade clears queued mutations for the retired budget/expense entities.
    this.version(38)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt, fileSize, fileMimeType",

        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, syncStatus, updatedAt, isDeleted",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        app_settings: "key",
      })
      .upgrade((tx) =>
        Promise.all([
          tx
            .table("offline_mutations")
            .where("entityType")
            .anyOf(["budget_allocations", "expenses"])
            .delete(),
          tx
            .table("syncQueue")
            .where("entityType")
            .anyOf(["budget_allocations", "expenses"])
            .delete(),
        ]),
      );

    this.version(39).stores({
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
    });

    this.version(40)
      .stores({
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      })
      .upgrade(async (tx) => {
        const allocations = await tx.table("budget_allocations").toArray();
        for (const alloc of allocations) {
          if (
            alloc.limitAmount !== undefined &&
            alloc.allocationValue === undefined
          ) {
            await tx.table("budget_allocations").update(alloc.id, {
              allocationType: alloc.allocationType || "fixed",
              allocationValue: alloc.limitAmount,
            });
          }
        }
      });

    this.version(41).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
      categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
      invoices:
        "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
      users:
        "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
      sale_items: "id, saleId, productId",
      workspaces:
        "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
      storages:
        "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
      suppliers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      customers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      employees:
        "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
      budget_settings: "id, workspaceId",
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      expense_series:
        "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
      expense_items:
        "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
      payroll_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      dividend_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      syncQueue: "id, entityType, entityId, operation, timestamp",
      offline_mutations:
        "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
      workspace_contacts: "id, workspaceId, type, value, syncStatus, updatedAt",
      loans:
        "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, syncStatus, updatedAt, isDeleted",
      loan_installments:
        "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
      loan_payments:
        "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
      sales_orders:
        "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      purchase_orders:
        "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      app_settings: "key",
    });

    this.version(42)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        inventory:
          "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
        suppliers:
          "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        customers:
          "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, syncStatus, updatedAt, isDeleted",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        sales_orders:
          "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        app_settings: "key",
      })
      .upgrade(async (tx) => {
        const products = await tx.table("products").toArray();
        const inventoryRows = products
          .filter(
            (product) =>
              typeof product.storageId === "string" &&
              product.storageId.length > 0,
          )
          .map((product) => ({
            id: `${product.id}:${product.storageId}`,
            workspaceId: product.workspaceId,
            productId: product.id,
            storageId: product.storageId,
            quantity:
              typeof product.quantity === "number" ? product.quantity : 0,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
            syncStatus: product.syncStatus,
            lastSyncedAt: product.lastSyncedAt,
            version: product.version,
            isDeleted: product.isDeleted,
          }));

        if (inventoryRows.length > 0) {
          await tx.table("inventory").bulkPut(inventoryRows);
        }
      });

    this.version(43).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
      categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
      invoices:
        "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
      users:
        "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
      sale_items: "id, saleId, productId",
      workspaces:
        "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
      storages:
        "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
      inventory:
        "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
      suppliers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      customers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      employees:
        "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
      budget_settings: "id, workspaceId",
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      expense_series:
        "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
      expense_items:
        "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
      payroll_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      dividend_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      syncQueue: "id, entityType, entityId, operation, timestamp",
      offline_mutations:
        "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
      workspace_contacts: "id, workspaceId, type, value, syncStatus, updatedAt",
      loans:
        "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
      loan_installments:
        "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
      loan_payments:
        "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
      sales_orders:
        "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      purchase_orders:
        "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      app_settings: "key",
    });

    this.version(44)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        inventory:
          "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
        suppliers:
          "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        customers:
          "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        sales_orders:
          "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        app_settings: "key",
      })
      .upgrade(async (tx) => {
        await tx
          .table("loans")
          .where("linkedPartyType")
          .equals("supplier")
          .modify({
            linkedPartyType: null,
            linkedPartyId: null,
            linkedPartyName: null,
          });
      });

    this.version(45).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
      categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
      invoices:
        "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
      users:
        "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
      sale_items: "id, saleId, productId",
      workspaces:
        "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
      storages:
        "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
      inventory:
        "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
      reorder_transfer_rules:
        "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
      suppliers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      customers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      employees:
        "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
      budget_settings: "id, workspaceId",
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      expense_series:
        "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
      expense_items:
        "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
      payroll_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      dividend_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      syncQueue: "id, entityType, entityId, operation, timestamp",
      offline_mutations:
        "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
      workspace_contacts: "id, workspaceId, type, value, syncStatus, updatedAt",
      loans:
        "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
      loan_installments:
        "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
      loan_payments:
        "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
      sales_orders:
        "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      purchase_orders:
        "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      app_settings: "key",
    });

    this.version(46).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
      categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
      invoices:
        "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
      users:
        "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
      sale_items: "id, saleId, productId",
      workspaces:
        "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
      storages:
        "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
      inventory:
        "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
      inventory_transfer_transactions:
        "id, workspaceId, productId, sourceStorageId, destinationStorageId, transferType, createdAt, isDeleted, [workspaceId+createdAt], [workspaceId+productId], [workspaceId+transferType]",
      reorder_transfer_rules:
        "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
      suppliers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      customers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      employees:
        "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
      budget_settings: "id, workspaceId",
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      expense_series:
        "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
      expense_items:
        "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
      payroll_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      dividend_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      syncQueue: "id, entityType, entityId, operation, timestamp",
      offline_mutations:
        "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
      workspace_contacts: "id, workspaceId, type, value, syncStatus, updatedAt",
      loans:
        "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
      loan_installments:
        "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
      loan_payments:
        "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
      sales_orders:
        "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      purchase_orders:
        "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      app_settings: "key",
    });

    this.version(47).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
      categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
      invoices:
        "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
      users:
        "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
      sale_items: "id, saleId, productId",
      workspaces:
        "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
      storages:
        "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
      inventory:
        "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
      inventory_transfer_transactions:
        "id, workspaceId, productId, sourceStorageId, destinationStorageId, transferType, createdAt, isDeleted, [workspaceId+createdAt], [workspaceId+productId], [workspaceId+transferType]",
      reorder_transfer_rules:
        "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
      suppliers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      customers:
        "id, name, workspaceId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
      employees:
        "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
      budget_settings: "id, workspaceId",
      budget_allocations: "id, workspaceId, month, [workspaceId+month]",
      expense_series:
        "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
      expense_items:
        "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
      payroll_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      dividend_statuses:
        "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
      syncQueue: "id, entityType, entityId, operation, timestamp",
      offline_mutations:
        "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
      workspace_contacts: "id, workspaceId, type, value, syncStatus, updatedAt",
      loans:
        "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
      loan_installments:
        "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
      loan_payments:
        "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
      sales_orders:
        "id, orderNumber, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      purchase_orders:
        "id, orderNumber, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
      travel_agency_sales:
        "id, saleNumber, workspaceId, saleDate, supplierId, isPaid, updatedAt, isDeleted, syncStatus, [workspaceId+saleDate], [workspaceId+isPaid]",
      app_settings: "key",
    });

    this.version(48)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        inventory:
          "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
        inventory_transfer_transactions:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, transferType, createdAt, isDeleted, [workspaceId+createdAt], [workspaceId+productId], [workspaceId+transferType]",
        reorder_transfer_rules:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
        suppliers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        customers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        business_partners:
          "id, name, workspaceId, role, customerFacetId, supplierFacetId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId",
        business_partner_merge_candidates:
          "id, workspaceId, primaryPartnerId, secondaryPartnerId, status, confidence, updatedAt, syncStatus, isDeleted",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        sales_orders:
          "id, orderNumber, businessPartnerId, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, businessPartnerId, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        travel_agency_sales:
          "id, saleNumber, workspaceId, saleDate, businessPartnerId, supplierId, isPaid, updatedAt, isDeleted, syncStatus, [workspaceId+saleDate], [workspaceId+isPaid]",
        app_settings: "key",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const customers = await tx.table("customers").toArray();
        const suppliers = await tx.table("suppliers").toArray();
        const existingPartners = await tx
          .table("business_partners")
          .toArray()
          .catch(() => []);
        const existingMergeCandidates = await tx
          .table("business_partner_merge_candidates")
          .toArray()
          .catch(() => []);
        const partnerMap = new Map<string, Record<string, unknown>>(
          existingPartners.map((partner: Record<string, unknown>) => [
            String(partner.id),
            partner,
          ]),
        );
        const customerPartnerIdByFacetId = new Map<string, string>();
        const supplierPartnerIdByFacetId = new Map<string, string>();

        const buildPartnerBase = (
          facet: Record<string, unknown>,
          partnerId: string,
          role: "customer" | "supplier",
        ) => ({
          id: partnerId,
          workspaceId: facet.workspaceId,
          name: facet.name,
          contactName: role === "supplier" ? facet.contactName : undefined,
          email: facet.email,
          phone: facet.phone,
          address: facet.address,
          city: facet.city,
          country: facet.country,
          defaultCurrency: facet.defaultCurrency || "usd",
          notes: facet.notes,
          role,
          creditLimit: Number(facet.creditLimit || 0),
          customerFacetId: role === "customer" ? facet.id : null,
          supplierFacetId: role === "supplier" ? facet.id : null,
          totalSalesOrders: 0,
          totalSalesValue: 0,
          receivableBalance: 0,
          totalPurchaseOrders: 0,
          totalPurchaseValue: 0,
          payableBalance: 0,
          totalLoanCount: 0,
          loanOutstandingBalance: 0,
          netExposure: 0,
          mergedIntoBusinessPartnerId: null,
          createdAt: facet.createdAt || now,
          updatedAt: facet.updatedAt || now,
          syncStatus: facet.syncStatus || "pending",
          lastSyncedAt: facet.lastSyncedAt || null,
          version: Number(facet.version || 1),
          isDeleted: Boolean(facet.isDeleted),
        });

        for (const customer of customers as Array<Record<string, unknown>>) {
          const facetId = String(customer.id);
          const partnerId =
            typeof customer.businessPartnerId === "string" &&
            customer.businessPartnerId
              ? customer.businessPartnerId
              : facetId;

          customer.businessPartnerId = partnerId;
          customerPartnerIdByFacetId.set(facetId, partnerId);
          if (!partnerMap.has(partnerId)) {
            partnerMap.set(
              partnerId,
              buildPartnerBase(customer, partnerId, "customer"),
            );
          }
        }

        for (const supplier of suppliers as Array<Record<string, unknown>>) {
          const facetId = String(supplier.id);
          const partnerId =
            typeof supplier.businessPartnerId === "string" &&
            supplier.businessPartnerId
              ? supplier.businessPartnerId
              : facetId;

          supplier.businessPartnerId = partnerId;
          supplierPartnerIdByFacetId.set(facetId, partnerId);
          if (!partnerMap.has(partnerId)) {
            partnerMap.set(
              partnerId,
              buildPartnerBase(supplier, partnerId, "supplier"),
            );
          }
        }

        await tx.table("customers").bulkPut(customers);
        await tx.table("suppliers").bulkPut(suppliers);
        await tx
          .table("business_partners")
          .bulkPut(Array.from(partnerMap.values()));

        const salesOrders = await tx.table("sales_orders").toArray();
        for (const order of salesOrders as Array<Record<string, unknown>>) {
          if (
            !order.businessPartnerId &&
            typeof order.customerId === "string"
          ) {
            order.businessPartnerId =
              customerPartnerIdByFacetId.get(order.customerId) || null;
          }
        }
        if (salesOrders.length > 0) {
          await tx.table("sales_orders").bulkPut(salesOrders);
        }

        const purchaseOrders = await tx.table("purchase_orders").toArray();
        for (const order of purchaseOrders as Array<Record<string, unknown>>) {
          if (
            !order.businessPartnerId &&
            typeof order.supplierId === "string"
          ) {
            order.businessPartnerId =
              supplierPartnerIdByFacetId.get(order.supplierId) || null;
          }
        }
        if (purchaseOrders.length > 0) {
          await tx.table("purchase_orders").bulkPut(purchaseOrders);
        }

        const travelSales = await tx
          .table("travel_agency_sales")
          .toArray()
          .catch(() => []);
        for (const sale of travelSales as Array<Record<string, unknown>>) {
          if (!sale.businessPartnerId && typeof sale.supplierId === "string") {
            sale.businessPartnerId =
              supplierPartnerIdByFacetId.get(sale.supplierId) || null;
          }
        }
        if (travelSales.length > 0) {
          await tx.table("travel_agency_sales").bulkPut(travelSales);
        }

        const loans = await tx.table("loans").toArray();
        for (const loan of loans as Array<Record<string, unknown>>) {
          if (
            loan.linkedPartyType === "customer" &&
            typeof loan.linkedPartyId === "string"
          ) {
            loan.linkedPartyType = "business_partner";
            loan.linkedPartyId =
              customerPartnerIdByFacetId.get(loan.linkedPartyId) || null;
          }
        }
        if (loans.length > 0) {
          await tx.table("loans").bulkPut(loans);
        }

        const normalizeValue = (value: unknown) =>
          String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        const candidateMap = new Map<string, Record<string, unknown>>(
          existingMergeCandidates.map((candidate: Record<string, unknown>) => [
            String(candidate.id),
            candidate,
          ]),
        );

        for (const customer of customers as Array<Record<string, unknown>>) {
          const customerPartnerId = customerPartnerIdByFacetId.get(
            String(customer.id),
          );
          if (!customerPartnerId) {
            continue;
          }
          const customerName = normalizeValue(customer.name);
          const customerPhone = normalizeValue(customer.phone);
          const customerEmail = normalizeValue(customer.email);

          for (const supplier of suppliers as Array<Record<string, unknown>>) {
            const supplierPartnerId = supplierPartnerIdByFacetId.get(
              String(supplier.id),
            );
            if (
              !supplierPartnerId ||
              customer.workspaceId !== supplier.workspaceId
            ) {
              continue;
            }

            const supplierName = normalizeValue(supplier.name);
            const supplierPhone = normalizeValue(supplier.phone);
            const supplierEmail = normalizeValue(supplier.email);
            const exactName = customerName && customerName === supplierName;
            const phoneMatch = customerPhone && customerPhone === supplierPhone;
            const emailMatch = customerEmail && customerEmail === supplierEmail;

            if (!exactName && !phoneMatch && !emailMatch) {
              continue;
            }

            const confidence =
              exactName && (phoneMatch || emailMatch)
                ? 0.98
                : exactName
                  ? 0.86
                  : 0.78;
            const candidateId = `${customerPartnerId}:${supplierPartnerId}`;
            if (candidateMap.has(candidateId)) {
              continue;
            }

            const reasons = [
              exactName ? "matching name" : "",
              phoneMatch ? "matching phone" : "",
              emailMatch ? "matching email" : "",
            ].filter(Boolean);

            candidateMap.set(candidateId, {
              id: candidateId,
              workspaceId: customer.workspaceId,
              primaryPartnerId: customerPartnerId,
              secondaryPartnerId: supplierPartnerId,
              mergeType: "customer_supplier",
              reason: reasons.join(", "),
              confidence,
              status: "pending",
              createdAt: now,
              updatedAt: now,
              syncStatus: "pending",
              lastSyncedAt: null,
              version: 1,
              isDeleted: false,
            });
          }
        }

        if (candidateMap.size > 0) {
          await tx
            .table("business_partner_merge_candidates")
            .bulkPut(Array.from(candidateMap.values()));
        }
      });

    this.version(49)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        inventory:
          "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
        inventory_transfer_transactions:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, transferType, createdAt, isDeleted, [workspaceId+createdAt], [workspaceId+productId], [workspaceId+transferType]",
        reorder_transfer_rules:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
        suppliers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        customers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        business_partners:
          "id, name, workspaceId, role, customerFacetId, supplierFacetId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId",
        business_partner_merge_candidates:
          "id, workspaceId, primaryPartnerId, secondaryPartnerId, status, confidence, updatedAt, syncStatus, isDeleted",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, loanCategory, direction, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted, [workspaceId+loanCategory], [workspaceId+direction]",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        sales_orders:
          "id, orderNumber, businessPartnerId, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, businessPartnerId, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        travel_agency_sales:
          "id, saleNumber, workspaceId, saleDate, businessPartnerId, supplierId, isPaid, updatedAt, isDeleted, syncStatus, [workspaceId+saleDate], [workspaceId+isPaid]",
        app_settings: "key",
      })
      .upgrade(async (tx) => {
        const loans = await tx.table("loans").toArray();
        if (loans.length === 0) {
          return;
        }

        for (const loan of loans as Array<Record<string, unknown>>) {
          if (
            loan.loanCategory !== "simple" &&
            loan.loanCategory !== "standard"
          ) {
            loan.loanCategory = "standard";
          }
          if (loan.direction !== "borrowed" && loan.direction !== "lent") {
            loan.direction = "lent";
          }
        }

        await tx.table("loans").bulkPut(loans);
      });

    this.version(50)
      .stores({
        products:
          "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned",
        categories: "id, name, workspaceId, syncStatus, updatedAt, isDeleted",
        invoices:
          "id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt",
        users:
          "id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget",
        sales:
          "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes",
        sale_items: "id, saleId, productId",
        workspaces:
          "id, name, code, syncStatus, updatedAt, isDeleted, print_lang, print_qr",
        storages:
          "id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted",
        inventory:
          "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId]",
        inventory_transfer_transactions:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, transferType, createdAt, isDeleted, [workspaceId+createdAt], [workspaceId+productId], [workspaceId+transferType]",
        reorder_transfer_rules:
          "id, workspaceId, productId, sourceStorageId, destinationStorageId, isIndefinite, expiresOn, updatedAt, isDeleted, [workspaceId+productId], [workspaceId+destinationStorageId], [workspaceId+expiresOn]",
        suppliers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        customers:
          "id, name, workspaceId, businessPartnerId, phone, email, defaultCurrency, updatedAt, isDeleted, syncStatus",
        business_partners:
          "id, name, workspaceId, role, customerFacetId, supplierFacetId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId",
        business_partner_merge_candidates:
          "id, workspaceId, primaryPartnerId, secondaryPartnerId, status, confidence, updatedAt, syncStatus, isDeleted",
        employees:
          "id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted",
        budget_settings: "id, workspaceId",
        budget_allocations: "id, workspaceId, month, [workspaceId+month]",
        expense_series:
          "id, workspaceId, recurrence, startMonth, endMonth, isDeleted",
        expense_items:
          "id, workspaceId, seriesId, month, dueDate, status, [seriesId+month], [workspaceId+month]",
        payroll_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        dividend_statuses:
          "id, workspaceId, employeeId, month, status, [employeeId+month], [workspaceId+month]",
        syncQueue: "id, entityType, entityId, operation, timestamp",
        offline_mutations:
          "id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]",
        workspace_contacts:
          "id, workspaceId, type, value, syncStatus, updatedAt",
        loans:
          "id, workspaceId, saleId, loanCategory, direction, status, nextDueDate, borrowerName, loanNo, linkedPartyType, linkedPartyId, syncStatus, updatedAt, isDeleted, [workspaceId+loanCategory], [workspaceId+direction]",
        loan_installments:
          "id, loanId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [loanId+installmentNo]",
        loan_payments:
          "id, loanId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
        payment_transactions:
          "id, workspaceId, paidAt, sourceModule, sourceType, sourceRecordId, sourceSubrecordId, direction, reversalOfTransactionId, updatedAt, isDeleted, syncStatus, [workspaceId+paidAt], [workspaceId+sourceType+sourceRecordId]",
        sales_orders:
          "id, orderNumber, businessPartnerId, customerId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, businessPartnerId, supplierId, workspaceId, status, currency, createdAt, updatedAt, isDeleted, syncStatus",
        travel_agency_sales:
          "id, saleNumber, workspaceId, saleDate, businessPartnerId, supplierId, isPaid, updatedAt, isDeleted, syncStatus, [workspaceId+saleDate], [workspaceId+isPaid]",
        app_settings: "key",
      })
      .upgrade(async (tx) => {
        const paymentTransactionsTable = tx.table("payment_transactions");
        const existingCount = await paymentTransactionsTable.count();
        if (existingCount > 0) {
          return;
        }

        const now = new Date().toISOString();
        const [
          loans,
          loanPayments,
          salesOrders,
          purchaseOrders,
          expenseItems,
          expenseSeries,
          payrollStatuses,
          employees,
        ] = await Promise.all([
          tx.table("loans").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("loan_payments").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("sales_orders").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("purchase_orders").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("expense_items").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("expense_series").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("payroll_statuses").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("employees").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
        ]);

        const loanById = new Map(loans.map((loan) => [String(loan.id), loan]));
        const expenseSeriesById = new Map(
          expenseSeries.map((series) => [String(series.id), series]),
        );
        const employeeById = new Map(
          employees.map((employee) => [String(employee.id), employee]),
        );
        const rows: Array<Record<string, unknown>> = [];

        const createRow = (input: Record<string, unknown>) => ({
          syncStatus: "synced",
          lastSyncedAt: now,
          version: 1,
          isDeleted: false,
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? input.createdAt ?? now,
          metadata: {
            backfilled: true,
            ...(typeof input.metadata === "object" && input.metadata !== null
              ? (input.metadata as Record<string, unknown>)
              : {}),
          },
          ...input,
        });

        for (const loan of loans) {
          if (loan.isDeleted || loan.source !== "manual") {
            continue;
          }

          rows.push(
            createRow({
              id: crypto.randomUUID(),
              workspaceId: loan.workspaceId,
              sourceModule: "loans",
              sourceType: "loan_origination",
              sourceRecordId: loan.id,
              sourceSubrecordId: null,
              direction:
                loan.direction === "borrowed" ? "incoming" : "outgoing",
              amount: loan.principalAmount ?? 0,
              currency: loan.settlementCurrency ?? "usd",
              paymentMethod: "unknown",
              paidAt: loan.createdAt ?? now,
              counterpartyName: loan.borrowerName ?? null,
              referenceLabel: loan.loanNo ?? null,
              note: loan.notes ?? null,
              createdBy: loan.createdBy ?? null,
              reversalOfTransactionId: null,
              createdAt: loan.createdAt ?? now,
              updatedAt: loan.updatedAt ?? loan.createdAt ?? now,
              metadata: {
                loanCategory: loan.loanCategory ?? "standard",
                loanDirection: loan.direction ?? "lent",
                origination: true,
              },
            }),
          );
        }

        for (const payment of loanPayments) {
          if (payment.isDeleted) {
            continue;
          }

          const loan = loanById.get(String(payment.loanId));
          if (!loan) {
            continue;
          }

          rows.push(
            createRow({
              id: payment.id,
              workspaceId: payment.workspaceId,
              sourceModule: "loans",
              sourceType:
                loan.loanCategory === "simple" ? "simple_loan" : "loan_payment",
              sourceRecordId: loan.id,
              sourceSubrecordId: payment.id,
              direction:
                loan.direction === "borrowed" ? "outgoing" : "incoming",
              amount: payment.amount,
              currency: loan.settlementCurrency ?? "usd",
              paymentMethod: payment.paymentMethod ?? "unknown",
              paidAt: payment.paidAt,
              counterpartyName: loan.borrowerName ?? null,
              referenceLabel: loan.loanNo ?? null,
              note: payment.note ?? null,
              createdBy: payment.createdBy ?? null,
              reversalOfTransactionId: null,
              createdAt: payment.createdAt ?? payment.paidAt ?? now,
              updatedAt:
                payment.updatedAt ?? payment.createdAt ?? payment.paidAt ?? now,
              metadata: {
                loanPaymentId: payment.id,
                loanCategory: loan.loanCategory ?? "standard",
                loanDirection: loan.direction ?? "lent",
              },
            }),
          );
        }

        for (const order of salesOrders) {
          if (order.isDeleted || !order.isPaid) {
            continue;
          }

          rows.push(
            createRow({
              id: crypto.randomUUID(),
              workspaceId: order.workspaceId,
              sourceModule: "orders",
              sourceType: "sales_order",
              sourceRecordId: order.id,
              sourceSubrecordId: null,
              direction: "incoming",
              amount: order.total ?? 0,
              currency: order.currency ?? "usd",
              paymentMethod: order.paymentMethod ?? "unknown",
              paidAt: order.paidAt ?? order.updatedAt ?? order.createdAt ?? now,
              counterpartyName: order.customerName ?? null,
              referenceLabel: order.orderNumber ?? null,
              note: null,
              createdBy: null,
              reversalOfTransactionId: null,
              createdAt:
                order.paidAt ?? order.updatedAt ?? order.createdAt ?? now,
              updatedAt:
                order.updatedAt ?? order.paidAt ?? order.createdAt ?? now,
              metadata: {
                orderStatus: order.status ?? "draft",
              },
            }),
          );
        }

        for (const order of purchaseOrders) {
          if (order.isDeleted || !order.isPaid) {
            continue;
          }

          rows.push(
            createRow({
              id: crypto.randomUUID(),
              workspaceId: order.workspaceId,
              sourceModule: "orders",
              sourceType: "purchase_order",
              sourceRecordId: order.id,
              sourceSubrecordId: null,
              direction: "outgoing",
              amount: order.total ?? 0,
              currency: order.currency ?? "usd",
              paymentMethod: order.paymentMethod ?? "unknown",
              paidAt: order.paidAt ?? order.updatedAt ?? order.createdAt ?? now,
              counterpartyName: order.supplierName ?? null,
              referenceLabel: order.orderNumber ?? null,
              note: null,
              createdBy: null,
              reversalOfTransactionId: null,
              createdAt:
                order.paidAt ?? order.updatedAt ?? order.createdAt ?? now,
              updatedAt:
                order.updatedAt ?? order.paidAt ?? order.createdAt ?? now,
              metadata: {
                orderStatus: order.status ?? "draft",
              },
            }),
          );
        }

        for (const item of expenseItems) {
          if (item.isDeleted || item.status !== "paid") {
            continue;
          }

          const series = expenseSeriesById.get(String(item.seriesId));
          rows.push(
            createRow({
              id: crypto.randomUUID(),
              workspaceId: item.workspaceId,
              sourceModule: "budget",
              sourceType: "expense_item",
              sourceRecordId: item.id,
              sourceSubrecordId: item.seriesId ?? null,
              direction: "outgoing",
              amount: item.amount ?? 0,
              currency: item.currency ?? "usd",
              paymentMethod: "unknown",
              paidAt: item.paidAt ?? item.updatedAt ?? item.createdAt ?? now,
              counterpartyName: null,
              referenceLabel: series?.name ? String(series.name) : "Expense",
              note: null,
              createdBy: null,
              reversalOfTransactionId: null,
              createdAt: item.paidAt ?? item.updatedAt ?? item.createdAt ?? now,
              updatedAt: item.updatedAt ?? item.paidAt ?? item.createdAt ?? now,
              metadata: {
                month: item.month ?? null,
                seriesId: item.seriesId ?? null,
                category: series?.category ?? null,
                subcategory: series?.subcategory ?? null,
              },
            }),
          );
        }

        for (const status of payrollStatuses) {
          if (status.isDeleted || status.status !== "paid") {
            continue;
          }

          const employee = employeeById.get(String(status.employeeId));
          rows.push(
            createRow({
              id: crypto.randomUUID(),
              workspaceId: status.workspaceId,
              sourceModule: "budget",
              sourceType: "payroll_status",
              sourceRecordId: status.id,
              sourceSubrecordId: status.employeeId ?? null,
              direction: "outgoing",
              amount: employee?.salary ?? 0,
              currency: employee?.salaryCurrency ?? "usd",
              paymentMethod: "unknown",
              paidAt:
                status.paidAt ?? status.updatedAt ?? status.createdAt ?? now,
              counterpartyName: employee?.name ?? null,
              referenceLabel: employee?.name
                ? `${employee.name} • ${String(status.month ?? "")}`
                : String(status.month ?? "Payroll"),
              note: null,
              createdBy: null,
              reversalOfTransactionId: null,
              createdAt:
                status.paidAt ?? status.updatedAt ?? status.createdAt ?? now,
              updatedAt:
                status.updatedAt ?? status.paidAt ?? status.createdAt ?? now,
              metadata: {
                employeeId: status.employeeId ?? null,
                month: status.month ?? null,
              },
            }),
          );
        }

        if (rows.length > 0) {
          await paymentTransactionsTable.bulkPut(rows);
        }
      });

    this.version(51)
      .stores({
        storages:
          "id, name, workspaceId, isSystem, isProtected, isPrimary, syncStatus, updatedAt, isDeleted",
      })
      .upgrade(async (tx) => {
        const storageRows = (await tx.table("storages").toArray()) as Array<
          Record<string, unknown>
        >;
        if (storageRows.length === 0) {
          return;
        }

        const rowsByWorkspace = new Map<
          string,
          Array<Record<string, unknown>>
        >();
        for (const row of storageRows) {
          const workspaceId = String(row.workspaceId || "");
          if (!workspaceId) {
            row.isPrimary = false;
            continue;
          }

          const workspaceRows = rowsByWorkspace.get(workspaceId) ?? [];
          workspaceRows.push(row);
          rowsByWorkspace.set(workspaceId, workspaceRows);
        }

        for (const workspaceRows of rowsByWorkspace.values()) {
          const activeRows = workspaceRows.filter((row) => !row.isDeleted);
          const primaryRow =
            activeRows.find((row) => row.isPrimary === true) ??
            activeRows.find(
              (row) =>
                row.isSystem === true &&
                String(row.name || "")
                  .trim()
                  .toLowerCase() === "main",
            ) ??
            activeRows[0];

          for (const row of workspaceRows) {
            row.isPrimary =
              !!primaryRow && !row.isDeleted && row.id === primaryRow.id;
          }
        }

        await tx.table("storages").bulkPut(storageRows);
      });

    this.version(52).stores({
      product_discounts:
        "id, workspaceId, productId, isActive, startsAt, endsAt, updatedAt, isDeleted, [workspaceId+productId]",
      category_discounts:
        "id, workspaceId, categoryId, isActive, startsAt, endsAt, updatedAt, isDeleted, [workspaceId+categoryId]",
    });

    this.version(53)
      .stores({
        product_barcodes:
          "id, productId, workspaceId, barcode, isPrimary, updatedAt, isDeleted, [workspaceId+barcode], [productId+isPrimary]",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const barcodeTable = tx.table("product_barcodes");
        const products = (await tx.table("products").toArray()) as Array<
          Record<string, unknown>
        >;
        const existingBarcodes = (await barcodeTable.toArray()) as Array<
          Record<string, unknown>
        >;
        const activeBarcodeKeys = new Set(
          existingBarcodes
            .filter((row) => !row.isDeleted)
            .map(
              (row) =>
                `${String(row.workspaceId ?? "")}::${String(row.barcode ?? "")}`,
            ),
        );
        const barcodeRowsToInsert: Array<Record<string, unknown>> = [];
        const productsToUpdate: Array<Record<string, unknown>> = [];

        for (const product of products) {
          const workspaceId = String(product.workspaceId ?? "");
          const productId = String(product.id ?? "");
          const legacyBarcode = String(product.barcode ?? "").trim();
          if (!workspaceId || !productId) {
            continue;
          }

          if (!legacyBarcode) {
            continue;
          }

          const barcodeKey = `${workspaceId}::${legacyBarcode}`;
          if (activeBarcodeKeys.has(barcodeKey)) {
            continue;
          }

          barcodeRowsToInsert.push({
            id: crypto.randomUUID(),
            workspaceId,
            productId,
            barcode: legacyBarcode,
            label: undefined,
            isPrimary: true,
            createdAt: String(product.createdAt ?? now),
            updatedAt: String(product.updatedAt ?? product.createdAt ?? now),
            syncStatus: product.syncStatus ?? "synced",
            lastSyncedAt: product.lastSyncedAt ?? null,
            version: typeof product.version === "number" ? product.version : 1,
            isDeleted: false,
          });
          productsToUpdate.push({
            ...product,
            barcode: legacyBarcode,
            barcodes: [legacyBarcode],
          });
          activeBarcodeKeys.add(barcodeKey);
        }

        if (barcodeRowsToInsert.length > 0) {
          await barcodeTable.bulkPut(barcodeRowsToInsert);
        }

        if (productsToUpdate.length > 0) {
          await tx.table("products").bulkPut(productsToUpdate);
        }
      });

    this.version(54).stores({
      stock_adjustments:
        "id, workspaceId, productId, storageId, adjustmentType, reason, createdAt, isDeleted, [workspaceId+productId], [workspaceId+createdAt]",
      inventory_transactions:
        "id, workspaceId, productId, storageId, transactionType, referenceId, createdAt, isDeleted, [workspaceId+productId], [workspaceId+createdAt], [workspaceId+transactionType]",
      stock_batches:
        "id, workspaceId, productId, storageId, batchNumber, expiryDate, isDeleted, [workspaceId+productId], [productId+storageId]",
    });

    this.version(55)
      .stores({
        stock_adjustments: null,
        inventory_transactions:
          "id, workspaceId, productId, storageId, transactionType, adjustmentReason, referenceId, createdAt, isDeleted, [workspaceId+productId], [workspaceId+createdAt], [workspaceId+transactionType], [workspaceId+adjustmentReason]",
        stock_batches:
          "id, workspaceId, productId, storageId, batchNumber, expiryDate, isDeleted, [workspaceId+productId], [productId+storageId]",
      })
      .upgrade(async (tx) => {
        const stockAdjustmentTable = tx.table("stock_adjustments");
        const inventoryTransactionTable = tx.table("inventory_transactions");
        const offlineMutationTable = tx.table("offline_mutations");
        const syncQueueTable = tx.table("syncQueue");

        const [
          stockAdjustmentRows,
          inventoryTransactionRows,
          offlineMutationRows,
          syncQueueRows,
        ] = await Promise.all([
          stockAdjustmentTable.toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          inventoryTransactionTable.toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          offlineMutationTable.toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          syncQueueTable.toArray() as Promise<Array<Record<string, unknown>>>,
        ]);

        const stockAdjustmentIds = new Set(
          stockAdjustmentRows
            .map((row) => getStringValue(row, "id"))
            .filter((id): id is string => !!id),
        );

        const legacyTransactionByAdjustmentId = new Map<
          string,
          Record<string, unknown>
        >();
        for (const row of inventoryTransactionRows) {
          if (getStringValue(row, "transactionType") !== "stock_adjustment") {
            continue;
          }

          const referenceId = getStringValue(row, "referenceId");
          const rowId = getStringValue(row, "id");
          if (referenceId && stockAdjustmentIds.has(referenceId)) {
            legacyTransactionByAdjustmentId.set(referenceId, row);
            continue;
          }

          if (rowId && stockAdjustmentIds.has(rowId)) {
            legacyTransactionByAdjustmentId.set(rowId, row);
          }
        }

        for (const adjustmentRow of stockAdjustmentRows) {
          const adjustmentId = getStringValue(adjustmentRow, "id");
          if (!adjustmentId) {
            continue;
          }

          const legacyTransaction =
            legacyTransactionByAdjustmentId.get(adjustmentId);
          const canonicalTransaction =
            buildInventoryTransactionFromStockAdjustmentRecord(
              adjustmentRow,
              legacyTransaction,
            );

          if (!canonicalTransaction) {
            continue;
          }

          await inventoryTransactionTable.put(canonicalTransaction);

          const legacyTransactionId = getStringValue(legacyTransaction, "id");
          if (legacyTransactionId && legacyTransactionId !== adjustmentId) {
            await inventoryTransactionTable.delete(legacyTransactionId);
          }
        }

        const convertedMutationIdsByAdjustmentId = new Map<string, string>();
        for (const mutationRow of offlineMutationRows) {
          if (
            getStringValue(mutationRow, "entityType") !== "stock_adjustments"
          ) {
            continue;
          }

          const mutationId = getStringValue(mutationRow, "id");
          const payload = mutationRow.payload as
            | Record<string, unknown>
            | undefined;
          const adjustmentId =
            getStringValue(payload, "id") ??
            getStringValue(mutationRow, "entityId");

          if (!mutationId || !adjustmentId) {
            continue;
          }

          const canonicalPayload =
            buildInventoryTransactionFromStockAdjustmentRecord(
              {
                ...(payload ?? {}),
                id: adjustmentId,
                workspaceId:
                  getStringValue(payload, "workspaceId") ??
                  getStringValue(mutationRow, "workspaceId"),
              },
              legacyTransactionByAdjustmentId.get(adjustmentId),
            );

          if (!canonicalPayload) {
            continue;
          }

          await offlineMutationTable.update(mutationId, {
            entityType: "inventory_transactions",
            entityId: adjustmentId,
            payload: canonicalPayload,
          });
          convertedMutationIdsByAdjustmentId.set(adjustmentId, mutationId);
        }

        for (const mutationRow of offlineMutationRows) {
          if (
            getStringValue(mutationRow, "entityType") !==
            "inventory_transactions"
          ) {
            continue;
          }

          const mutationId = getStringValue(mutationRow, "id");
          const entityId = getStringValue(mutationRow, "entityId");
          const payload = mutationRow.payload as
            | Record<string, unknown>
            | undefined;
          const transactionType = getStringValue(payload, "transactionType");

          if (!mutationId || transactionType !== "stock_adjustment") {
            continue;
          }

          const adjustmentId = getStringValue(payload, "referenceId");
          if (
            !adjustmentId ||
            !stockAdjustmentIds.has(adjustmentId) ||
            adjustmentId === entityId
          ) {
            continue;
          }

          if (convertedMutationIdsByAdjustmentId.has(adjustmentId)) {
            await offlineMutationTable.delete(mutationId);
            continue;
          }

          const canonicalPayload =
            normalizeStockAdjustmentInventoryTransactionRecord(
              {
                ...(payload ?? {}),
                id: adjustmentId,
                workspaceId:
                  getStringValue(payload, "workspaceId") ??
                  getStringValue(mutationRow, "workspaceId"),
              },
              adjustmentId,
            );

          if (!canonicalPayload) {
            continue;
          }

          await offlineMutationTable.update(mutationId, {
            entityId: adjustmentId,
            payload: canonicalPayload,
          });
        }

        const convertedSyncQueueIdsByAdjustmentId = new Map<string, string>();
        for (const queueRow of syncQueueRows) {
          if (getStringValue(queueRow, "entityType") !== "stock_adjustments") {
            continue;
          }

          const queueId = getStringValue(queueRow, "id");
          const adjustmentId = getStringValue(queueRow, "entityId");
          const data = queueRow.data as Record<string, unknown> | undefined;

          if (!queueId || !adjustmentId) {
            continue;
          }

          const canonicalPayload =
            buildInventoryTransactionFromStockAdjustmentRecord(
              {
                ...(data ?? {}),
                id: adjustmentId,
                workspaceId: getStringValue(data, "workspaceId"),
              },
              legacyTransactionByAdjustmentId.get(adjustmentId),
            );

          if (!canonicalPayload) {
            continue;
          }

          await syncQueueTable.update(queueId, {
            entityType: "inventory_transactions",
            entityId: adjustmentId,
            data: canonicalPayload,
          });
          convertedSyncQueueIdsByAdjustmentId.set(adjustmentId, queueId);
        }

        for (const queueRow of syncQueueRows) {
          if (
            getStringValue(queueRow, "entityType") !== "inventory_transactions"
          ) {
            continue;
          }

          const queueId = getStringValue(queueRow, "id");
          const entityId = getStringValue(queueRow, "entityId");
          const data = queueRow.data as Record<string, unknown> | undefined;
          const transactionType = getStringValue(data, "transactionType");

          if (!queueId || transactionType !== "stock_adjustment") {
            continue;
          }

          const adjustmentId = getStringValue(data, "referenceId");
          if (
            !adjustmentId ||
            !stockAdjustmentIds.has(adjustmentId) ||
            adjustmentId === entityId
          ) {
            continue;
          }

          if (convertedSyncQueueIdsByAdjustmentId.has(adjustmentId)) {
            await syncQueueTable.delete(queueId);
            continue;
          }

          const canonicalPayload =
            normalizeStockAdjustmentInventoryTransactionRecord(
              {
                ...(data ?? {}),
                id: adjustmentId,
              },
              adjustmentId,
            );

          if (!canonicalPayload) {
            continue;
          }

          await syncQueueTable.update(queueId, {
            entityId: adjustmentId,
            data: canonicalPayload,
          });
        }
      });

    this.version(56)
      .stores({
        storages:
          "id, name, workspaceId, isSystem, isProtected, isPrimary, isMarketplace, syncStatus, updatedAt, isDeleted",
      })
      .upgrade(async (tx) => {
        const storageRows = (await tx.table("storages").toArray()) as Array<
          Record<string, unknown>
        >;
        if (storageRows.length === 0) {
          return;
        }

        const rowsByWorkspace = new Map<
          string,
          Array<Record<string, unknown>>
        >();
        for (const row of storageRows) {
          const workspaceId = String(row.workspaceId || "");
          if (!workspaceId) {
            row.isMarketplace = false;
            continue;
          }

          const workspaceRows = rowsByWorkspace.get(workspaceId) ?? [];
          workspaceRows.push(row);
          rowsByWorkspace.set(workspaceId, workspaceRows);
        }

        for (const workspaceRows of rowsByWorkspace.values()) {
          const activeRows = workspaceRows.filter((row) => !row.isDeleted);
          const marketplaceRow =
            activeRows.find((row) => row.isMarketplace === true) ??
            activeRows.find((row) => row.isPrimary === true) ??
            activeRows.find(
              (row) =>
                row.isSystem === true &&
                String(row.name || "")
                  .trim()
                  .toLowerCase() === "main",
            ) ??
            activeRows[0];

          for (const row of workspaceRows) {
            row.isMarketplace =
              !!marketplaceRow && !row.isDeleted && row.id === marketplaceRow.id;
          }
        }

        await tx.table("storages").bulkPut(storageRows);
      });

    this.version(57)
      .stores({
        stock_batches:
          "id, workspaceId, productId, storageId, batchNumber, expiryDate, isDeleted, [workspaceId+productId], [productId+storageId]",
      })
      .upgrade(async (tx) => {
        const [batchRows, productRows] = await Promise.all([
          tx.table("stock_batches").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
          tx.table("products").toArray() as Promise<
            Array<Record<string, unknown>>
          >,
        ]);

        if (batchRows.length === 0) {
          return;
        }

        const productById = new Map<string, Record<string, unknown>>();
        for (const productRow of productRows) {
          const productId = getStringValue(productRow, "id");
          if (productId) {
            productById.set(productId, productRow);
          }
        }

        for (const batchRow of batchRows) {
          const product = productById.get(getStringValue(batchRow, "productId") ?? "");
          batchRow.price = getNumberValue(
            batchRow,
            "price",
            getNumberValue(product, "price", 0),
          );
          batchRow.costPrice = getNumberValue(
            batchRow,
            "costPrice",
            getNumberValue(product, "costPrice", 0),
          );
          batchRow.currency = getCurrencyCodeValue(
            batchRow,
            "currency",
            getCurrencyCodeValue(product, "currency", "usd"),
          );
        }

        await tx.table("stock_batches").bulkPut(batchRows);
      });

    this.version(59).stores({
      real_estate_transactions:
        "id, workspaceId, transactionNo, transactionType, propertyType, status, currency, buyerBusinessPartnerId, sellerBusinessPartnerId, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+status], [workspaceId+createdAt]",
      real_estate_installments:
        "id, transactionId, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [transactionId+installmentNo], [workspaceId+dueDate], [workspaceId+status]",
      real_estate_payments:
        "id, transactionId, workspaceId, paidAt, syncStatus, updatedAt, isDeleted",
    });

    this.version(60).stores({
      exchange_transactions:
        "id, workspaceId, transactionNo, transactionType, transactionDate, fromCurrency, toCurrency, paymentMethod, employeeUserId, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+createdAt], [workspaceId+transactionDate], [workspaceId+transactionType]",
      exchange_fee_rules:
        "id, workspaceId, name, transactionScope, feeType, currency, effectiveStartDate, effectiveEndDate, isActive, isLocked, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+isActive], [workspaceId+transactionScope], [workspaceId+effectiveStartDate]",
    });

    this.version(61).stores({
      exchange_transactions:
        "id, workspaceId, transactionNo, transactionType, transactionDate, fromCurrency, toCurrency, safeId, profitCurrency, paymentMethod, employeeUserId, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+createdAt], [workspaceId+transactionDate], [workspaceId+transactionType], [workspaceId+safeId]",
      exchange_fee_rules:
        "id, workspaceId, name, transactionScope, feeType, currency, effectiveStartDate, effectiveEndDate, isActive, isLocked, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+isActive], [workspaceId+transactionScope], [workspaceId+effectiveStartDate]",
      fx_safes:
        "id, workspaceId, name, isActive, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+isActive], [workspaceId+createdAt]",
      fx_safe_balances:
        "id, workspaceId, safeId, currency, balanceAmount, updatedAt, isDeleted, syncStatus, [safeId+currency], [workspaceId+safeId], [workspaceId+currency]",
      fx_safe_movements:
        "id, workspaceId, safeId, currency, movementType, sourceType, sourceId, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+safeId], [safeId+currency], [sourceType+sourceId]",
    });

    this.version(62).stores({
      exchange_transactions:
        "id, workspaceId, transactionNo, transactionType, transactionDate, fromCurrency, toCurrency, safeId, profitCurrency, paymentMethod, employeeUserId, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+createdAt], [workspaceId+transactionDate], [workspaceId+transactionType], [workspaceId+safeId]",
    });

    this.version(63).stores({
      exchange_pair_prices:
        "id, workspaceId, baseCurrency, quoteCurrency, buyPrice, sellPrice, updatedAt, isDeleted, syncStatus, [workspaceId+baseCurrency+quoteCurrency], [workspaceId+updatedAt]",
    });

    this.version(64).stores({
      clinical_appointments:
        "id, workspaceId, patientId, appointmentDate, startTime, appointmentType, status, priority, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+appointmentDate], [workspaceId+status], [workspaceId+patientId]",
      clinical_patients:
        "id, workspaceId, name, phone, birthYear, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+name], [workspaceId+phone]",
      clinical_attachments:
        "id, workspaceId, appointmentId, fileName, fileType, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+appointmentId]",
    });

    this.version(65).stores({
      clinical_presets:
        "id, workspaceId, category, isActive, sortOrder, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+category], [workspaceId+sortOrder]",
    });

    this.version(66).stores({
      profiles: "id, workspaceId, name, role, [workspaceId+name]",
    });

    this.version(67).stores({
      sale_returns:
        "id, workspaceId, saleId, status, returnedAt, updatedAt, [workspaceId+saleId], [workspaceId+returnedAt]",
      sale_return_items:
        "id, workspaceId, returnId, saleId, saleItemId, updatedAt, [returnId+saleItemId], [workspaceId+saleId]",
    });

    this.version(68).stores({
      stock_batches:
        "id, workspaceId, productId, storageId, batchNumber, expiryDate, sourcePurchaseOrderId, sourcePurchaseOrderItemId, isDeleted, [workspaceId+productId], [productId+storageId], [sourcePurchaseOrderId+sourcePurchaseOrderItemId]",
    });

    this.version(69).stores({
      local_account_credentials:
        "id, workspaceId, userId, email, [workspaceId+userId]",
    });

    this.version(70)
      .stores({
        sales_orders:
          "id, orderNumber, businessPartnerId, customerId, workspaceId, status, paymentStatus, currency, nextDueDate, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, businessPartnerId, supplierId, workspaceId, status, paymentStatus, currency, nextDueDate, createdAt, updatedAt, isDeleted, syncStatus",
        order_installments:
          "id, orderId, orderType, workspaceId, dueDate, status, syncStatus, updatedAt, isDeleted, [orderId+installmentNo], [workspaceId+dueDate], [workspaceId+status]",
      })
      .upgrade(async (tx) => {
        const normalizeOrder = (order: Record<string, unknown>) => {
          const total = Math.max(0, Number(order.total || 0));
          const isPaid = order.isPaid === true;
          const paidAmount = isPaid ? total : 0;
          return {
            ...order,
            paymentStatus: isPaid ? "paid" : "unpaid",
            paidAmount,
            balanceAmount: Math.max(total - paidAmount, 0),
            isInstallmentBased: false,
            installmentCount: 0,
            installmentFrequency: null,
            firstDueDate: null,
            nextDueDate: null,
          };
        };

        const salesOrders = await tx.table("sales_orders").toArray();
        const purchaseOrders = await tx.table("purchase_orders").toArray();
        if (salesOrders.length > 0) {
          await tx.table("sales_orders").bulkPut(salesOrders.map(normalizeOrder));
        }
        if (purchaseOrders.length > 0) {
          await tx.table("purchase_orders").bulkPut(purchaseOrders.map(normalizeOrder));
        }
      });

    this.version(71).stores({
      workspace_permissions:
        "id, workspaceId, userUuid, key, module, [workspaceId+userUuid], [workspaceId+userUuid+key]",
    });

    this.version(72).stores({
      agents:
        "id, workspaceId, businessPartnerId, agentType, status, linkedUserId, updatedAt, isDeleted, syncStatus, [workspaceId+status], [workspaceId+agentType]",
      business_partners:
        "id, name, workspaceId, role, customerFacetId, supplierFacetId, agentFacetId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId",
    });

    this.version(73).stores({
      fleet_vehicles:
        "id, workspaceId, plateNumber, status, updatedAt, isDeleted, syncStatus, [workspaceId+plateNumber], [workspaceId+status]",
      fleet_vehicle_assignments:
        "id, workspaceId, vehicleId, agentId, status, assignedAt, endedAt, updatedAt, isDeleted, syncStatus, [workspaceId+status], [workspaceId+vehicleId], [workspaceId+agentId]",
    });

    this.version(75).stores({
      manual_entry_templates:
        "id, workspaceId, name, status, updatedAt, isDeleted",
      manual_entries:
        "id, workspaceId, templateId, createdAt",
    });

    this.version(74)
      .stores({
        sales_exchange:
          "id, saleId, workspaceId, baseCurrency, quoteCurrency, capturedAt, [saleId+baseCurrency+quoteCurrency+rateSide], [workspaceId+capturedAt]",
      })
      .upgrade(async (tx) => {
        const sales = (await tx.table("sales").toArray()) as Array<
          Record<string, unknown>
        >;
        const exchangeRows: SalesExchange[] = [];

        for (const sale of sales) {
          const saleId = getStringValue(sale, "id");
          const workspaceId = getStringValue(sale, "workspaceId");
          const snapshots = Array.isArray(sale.exchangeRates)
            ? sale.exchangeRates
            : [];

          if (saleId && workspaceId) {
            for (const [index, rawSnapshot] of snapshots.entries()) {
              const snapshot = rawSnapshot as Record<string, unknown>;
              const pair = getStringValue(snapshot, "pair")?.split("/") ?? [];
              const baseCurrency = pair[0]?.toLowerCase();
              const quoteCurrency = pair[1]?.toLowerCase();
              const quoteAmount = getNumberValue(snapshot, "rate", 0);
              const baseAmount = getNumberValue(
                snapshot,
                "priceBasisAmount",
                100,
              );

              if (
                !["usd", "eur", "iqd", "try"].includes(baseCurrency || "") ||
                !["usd", "eur", "iqd", "try"].includes(quoteCurrency || "") ||
                baseCurrency === quoteCurrency ||
                baseAmount <= 0 ||
                quoteAmount <= 0
              ) {
                continue;
              }

              const side = getStringValue(snapshot, "side");
              const capturedAt =
                getStringValue(snapshot, "timestamp") ||
                getStringValue(sale, "createdAt") ||
                new Date().toISOString();

              exchangeRows.push({
                id:
                  typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `${saleId}-exchange-${index}`,
                saleId,
                workspaceId,
                baseCurrency: baseCurrency as SalesExchange["baseCurrency"],
                quoteCurrency: quoteCurrency as SalesExchange["quoteCurrency"],
                baseAmount,
                quoteAmount,
                source: getStringValue(snapshot, "source") || "unknown",
                capturedAt,
                rateSide:
                  side === "buy" || side === "sell" ? side : ("mid" as const),
                sourcePriceId:
                  getNullableStringValue(snapshot, "priceRowId") ?? null,
                sourcePriceUpdatedAt:
                  getNullableStringValue(snapshot, "priceUpdatedAt") ?? null,
                createdAt: getStringValue(sale, "createdAt") || capturedAt,
              });
            }

            const legacyRate = getNumberValue(sale, "exchangeRate", 0);
            if (snapshots.length === 0 && legacyRate > 0) {
              const settlementCurrency = getStringValue(
                sale,
                "settlementCurrency",
              )?.toLowerCase();
              const saleItems = (await tx
                .table("sale_items")
                .where("saleId")
                .equals(saleId)
                .toArray()) as Array<Record<string, unknown>>;
              const sourceItem = saleItems.find((item) => {
                const originalCurrency = getStringValue(
                  item,
                  "originalCurrency",
                )?.toLowerCase();
                return (
                  originalCurrency &&
                  originalCurrency !== settlementCurrency &&
                  ["usd", "eur", "iqd", "try"].includes(originalCurrency)
                );
              });
              const baseCurrency = getStringValue(
                sourceItem,
                "originalCurrency",
              )?.toLowerCase();

              if (
                baseCurrency &&
                settlementCurrency &&
                ["usd", "eur", "iqd", "try"].includes(settlementCurrency)
              ) {
                const capturedAt =
                  getStringValue(sale, "exchangeRateTimestamp") ||
                  getStringValue(sale, "createdAt") ||
                  new Date().toISOString();
                exchangeRows.push({
                  id:
                    typeof crypto !== "undefined" && crypto.randomUUID
                      ? crypto.randomUUID()
                      : `${saleId}-exchange-legacy`,
                  saleId,
                  workspaceId,
                  baseCurrency: baseCurrency as SalesExchange["baseCurrency"],
                  quoteCurrency:
                    settlementCurrency as SalesExchange["quoteCurrency"],
                  baseAmount: 100,
                  quoteAmount: legacyRate,
                  source: getStringValue(sale, "exchangeSource") || "legacy",
                  capturedAt,
                  rateSide: "mid",
                  sourcePriceId: null,
                  sourcePriceUpdatedAt: null,
                  createdAt: getStringValue(sale, "createdAt") || capturedAt,
                });
              }
            }
          }

          delete sale.exchangeSource;
          delete sale.exchangeRate;
          delete sale.exchangeRateTimestamp;
          delete sale.exchangeRates;
        }

        if (sales.length > 0) {
          await tx.table("sales").bulkPut(sales);
        }
        if (exchangeRows.length > 0) {
          await tx.table("sales_exchange").bulkPut(exchangeRows);
        }
      });

    this.version(76)
      .stores({
        profiles:
          "id, workspaceId, currentWorkspaceId, name, role, [workspaceId+name], [currentWorkspaceId+name]",
      })
      .upgrade(async (tx) => {
        const profiles = (await tx.table("profiles").toArray()) as Array<
          Record<string, unknown>
        >;
        if (profiles.length > 0) {
          await tx.table("profiles").bulkPut(
            profiles.map((profile) => ({
              ...profile,
              currentWorkspaceId:
                typeof profile.currentWorkspaceId === "string"
                  ? profile.currentWorkspaceId
                  : profile.workspaceId,
            })),
          );
        }
      });

    this.version(77).stores({
      sales:
        "id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt, updatedAt, notes, [workspaceId+createdAt]",
    });

    this.version(78)
      .stores({
        loans:
          "id, saleId, orderId, orderType, loanNo, workspaceId, source, loanCategory, direction, linkedPartyId, borrowerName, status, nextDueDate, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+status], [workspaceId+loanCategory], [workspaceId+direction], [orderType+orderId]",
        sales_orders:
          "id, orderNumber, businessPartnerId, customerId, linkedLoanId, workspaceId, status, paymentStatus, paymentMethod, currency, nextDueDate, createdAt, updatedAt, isDeleted, syncStatus",
        purchase_orders:
          "id, orderNumber, businessPartnerId, supplierId, linkedLoanId, workspaceId, status, paymentStatus, paymentMethod, currency, nextDueDate, createdAt, updatedAt, isDeleted, syncStatus",
      })
      .upgrade(async (tx) => {
        const migratePartnerLimits = async () => {
          const partners = (await tx.table("business_partners").toArray()) as Array<Record<string, unknown>>;
          const migrated = partners.map((partner) => {
            const legacy = Number(partner.creditLimit || 0);
            const role = String(partner.role || "customer");
            const migratedLimit = legacy > 0 ? legacy : null;
            return {
              ...partner,
              receivableCreditLimit: partner.receivableCreditLimit !== undefined
                ? partner.receivableCreditLimit
                : role === "customer" || role === "both" ? migratedLimit : null,
              payableCreditLimit: partner.payableCreditLimit !== undefined
                ? partner.payableCreditLimit
                : role === "supplier" || role === "both" ? migratedLimit : null,
            };
          });
          if (migrated.length > 0) await tx.table("business_partners").bulkPut(migrated);
        };

        const migrateOrders = async (tableName: "sales_orders" | "purchase_orders", orderType: "sales" | "purchase") => {
          const orders = (await tx.table(tableName).toArray()) as Array<Record<string, unknown>>;
          const installmentRows = (await tx.table("order_installments").toArray()) as Array<Record<string, unknown>>;
          const facetRows = (await tx.table(orderType === "sales" ? "customers" : "suppliers").toArray()) as Array<Record<string, unknown>>;
          const partnerIdByFacetId = new Map(
            facetRows
              .filter((row) => typeof row.id === "string" && typeof row.businessPartnerId === "string")
              .map((row) => [row.id as string, row.businessPartnerId as string]),
          );
          const loans: Array<Record<string, unknown>> = [];
          const loanInstallments: Array<Record<string, unknown>> = [];
          const retiredOrderInstallments: Array<Record<string, unknown>> = [];

          for (const order of orders) {
            const legacyCredit = order.paymentMethod === "credit";
            const installmentFinancing = order.isInstallmentBased === true;
            const paymentMethod = legacyCredit
              ? installmentFinancing ? "installments" : "loan"
              : order.paymentMethod;
            const total = Math.max(0, Number(order.total || 0));
            const paidAmount = Math.min(total, Math.max(0, Number(order.paidAmount ?? (order.isPaid ? total : 0))));
            const balanceAmount = Math.max(0, Number(order.balanceAmount ?? (total - paidAmount)));
            const isActive = orderType === "sales"
              ? order.status === "pending" || order.status === "completed"
              : order.status === "ordered" || order.status === "received" || order.status === "completed";
            let linkedLoanId = typeof order.linkedLoanId === "string" ? order.linkedLoanId : null;

            if (
              legacyCredit
              && isActive
              && balanceAmount > 0
              && typeof order.workspaceId === "string"
              && isLocalWorkspaceMode(order.workspaceId)
            ) {
              linkedLoanId = crypto.randomUUID();
              const now = typeof order.updatedAt === "string" ? order.updatedAt : new Date().toISOString();
              const facetId = String(orderType === "sales" ? order.customerId || "" : order.supplierId || "");
              const linkedPartyId = typeof order.businessPartnerId === "string"
                ? order.businessPartnerId
                : partnerIdByFacetId.get(facetId) || facetId;
              const linkedPartyName = orderType === "sales" ? order.customerName : order.supplierName;
              const firstDueDate = typeof order.firstDueDate === "string" ? order.firstDueDate.slice(0, 10) : null;
              const category = installmentFinancing ? "standard" : "simple";
              const direction = orderType === "sales" ? "lent" : "borrowed";
              const existingSchedule = installmentRows
                .filter((row) => row.orderId === order.id && row.orderType === orderType && row.isDeleted !== true && Number(row.balanceAmount || 0) > 0)
                .sort((left, right) => Number(left.installmentNo || 0) - Number(right.installmentNo || 0));

              if (installmentFinancing) {
                for (const [index, row] of existingSchedule.entries()) {
                  const amount = Math.max(0, Number(row.balanceAmount || 0));
                  loanInstallments.push({
                    ...row,
                    id: crypto.randomUUID(),
                    loanId: linkedLoanId,
                    installmentNo: index + 1,
                    plannedAmount: amount,
                    paidAmount: 0,
                    balanceAmount: amount,
                    paidAt: null,
                    syncStatus: "synced",
                    lastSyncedAt: now,
                  });
                  retiredOrderInstallments.push({
                    ...row,
                    isDeleted: true,
                    updatedAt: now,
                    version: Number(row.version || 0) + 1,
                  });
                }

                if (existingSchedule.length === 0) {
                  const count = Math.max(1, Math.trunc(Number(order.installmentCount || 1)));
                  const frequency = String(order.installmentFrequency || "monthly");
                  const roundAmount = (amount: number) => Number(amount.toFixed(3));
                  const baseAmount = roundAmount(balanceAmount / count);
                  let allocated = 0;
                  const advanceDueDate = (index: number) => {
                    if (!firstDueDate) return null;
                    const base = new Date(`${firstDueDate}T00:00:00.000Z`);
                    if (frequency === "weekly" || frequency === "biweekly") {
                      base.setUTCDate(base.getUTCDate() + index * (frequency === "weekly" ? 7 : 14));
                      return base.toISOString().slice(0, 10);
                    }
                    const targetMonth = base.getUTCMonth() + index;
                    const targetYear = base.getUTCFullYear() + Math.floor(targetMonth / 12);
                    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
                    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
                    return new Date(Date.UTC(
                      targetYear,
                      normalizedMonth,
                      Math.min(base.getUTCDate(), lastDay),
                    )).toISOString().slice(0, 10);
                  };

                  for (let index = 0; index < count; index += 1) {
                    const amount = index === count - 1
                      ? roundAmount(balanceAmount - allocated)
                      : baseAmount;
                    allocated = roundAmount(allocated + amount);
                    const dueDate = advanceDueDate(index);
                    loanInstallments.push({
                      id: crypto.randomUUID(),
                      workspaceId: order.workspaceId,
                      loanId: linkedLoanId,
                      installmentNo: index + 1,
                      dueDate,
                      plannedAmount: amount,
                      paidAmount: 0,
                      balanceAmount: amount,
                      status: dueDate && dueDate < now.slice(0, 10) ? "overdue" : "unpaid",
                      paidAt: null,
                      createdAt: now,
                      updatedAt: now,
                      syncStatus: "synced",
                      lastSyncedAt: now,
                      version: 1,
                      isDeleted: false,
                    });
                  }
                }
              } else {
                loanInstallments.push({
                  id: crypto.randomUUID(),
                  workspaceId: order.workspaceId,
                  loanId: linkedLoanId,
                  installmentNo: 1,
                  dueDate: firstDueDate,
                  plannedAmount: balanceAmount,
                  paidAmount: 0,
                  balanceAmount,
                  status: firstDueDate && firstDueDate < now.slice(0, 10) ? "overdue" : "unpaid",
                  paidAt: null,
                  createdAt: now,
                  updatedAt: now,
                  syncStatus: "synced",
                  lastSyncedAt: now,
                  version: 1,
                  isDeleted: false,
                });
              }

              const nextDueDate = loanInstallments.find((row) => row.loanId === linkedLoanId && Number(row.balanceAmount || 0) > 0)?.dueDate ?? null;
              loans.push({
                id: linkedLoanId,
                workspaceId: order.workspaceId,
                saleId: null,
                orderId: order.id,
                orderType,
                loanNo: `${category === "simple" ? "SL" : "LN"}-${now.slice(0, 10).replace(/-/g, "")}-${linkedLoanId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
                source: "order",
                loanCategory: category,
                direction,
                linkedPartyType: "business_partner",
                linkedPartyId,
                linkedPartyName,
                borrowerName: linkedPartyName || "Order counterparty",
                borrowerPhone: "",
                borrowerAddress: "",
                borrowerNationalId: "",
                principalAmount: balanceAmount,
                totalPaidAmount: 0,
                balanceAmount,
                settlementCurrency: order.currency,
                exchangeRateSnapshot: order.exchangeRates ?? null,
                installmentCount: loanInstallments.filter((row) => row.loanId === linkedLoanId).length,
                installmentFrequency: order.installmentFrequency || "monthly",
                firstDueDate,
                nextDueDate,
                status: nextDueDate && nextDueDate < now.slice(0, 10) ? "overdue" : "active",
                notes: `Migrated from ${orderType} order ${String(order.orderNumber || order.id)}`,
                createdBy: order.createdBy ?? null,
                createdAt: now,
                updatedAt: now,
                syncStatus: "synced",
                lastSyncedAt: now,
                version: 1,
                isDeleted: false,
              });
            }

            order.paymentMethod = paymentMethod;
            order.initialPaymentAmount = legacyCredit
              ? paidAmount
              : Math.max(0, Number(order.initialPaymentAmount || 0));
            order.linkedLoanId = linkedLoanId;
            order.isInstallmentBased = paymentMethod === "installments";
          }

          if (orders.length > 0) await tx.table(tableName).bulkPut(orders);
          if (loans.length > 0) await tx.table("loans").bulkPut(loans);
          if (loanInstallments.length > 0) await tx.table("loan_installments").bulkPut(loanInstallments);
          if (retiredOrderInstallments.length > 0) await tx.table("order_installments").bulkPut(retiredOrderInstallments);
        };

        await migratePartnerLimits();
        await migrateOrders("sales_orders", "sales");
        await migrateOrders("purchase_orders", "purchase");
      });

    this.version(79)
      .stores({
        invoices:
          "id, invoiceid, sourceId, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, sequenceId, printFormat, r2PathA4, r2PathReceipt, latestVersionId, latestVersionNumber, [workspaceId+origin+sourceId]",
        invoice_versions:
          "id, invoiceId, workspaceId, sourceId, origin, versionNumber, format, createdBy, createdAt, syncStatus, [invoiceId+versionNumber], [workspaceId+invoiceId], [workspaceId+origin+sourceId]",
      })
      .upgrade(async (tx) => {
        const invoices = (await tx.table("invoices").toArray()) as Array<Record<string, unknown>>;
        const legacyVersions: Array<Record<string, unknown>> = [];

        for (const invoice of invoices) {
          const invoiceId = String(invoice.id || "");
          const workspaceId = String(invoice.workspaceId || "");
          if (!invoiceId || !workspaceId) continue;

          const sourceId = typeof invoice.sourceId === "string"
            ? invoice.sourceId
            : typeof invoice.orderId === "string" && invoice.orderId
              ? invoice.orderId
              : invoiceId;
          const origin = typeof invoice.origin === "string" && invoice.origin
            ? invoice.origin
            : "manual";
          const createdAt = typeof invoice.createdAt === "string"
            ? invoice.createdAt
            : new Date().toISOString();
          let versionNumber = 0;

          const addLegacyVersion = (format: "a4" | "receipt") => {
            const upper = format === "a4" ? "A4" : "Receipt";
            const r2Path = invoice[`r2Path${upper}`];
            const localPath = invoice[`localPath${upper}`];
            const pdfBlob = invoice[`pdfBlob${upper}`];
            if (!r2Path && !localPath && !pdfBlob) return;

            versionNumber += 1;
            const versionId = crypto.randomUUID();
            legacyVersions.push({
              id: versionId,
              invoiceId,
              workspaceId,
              sourceId,
              origin,
              versionNumber,
              format,
              r2Path,
              localPath,
              pdfBlob,
              fileSize: pdfBlob instanceof Blob ? pdfBlob.size : Number(invoice.fileSize || 0),
              createdBy: invoice.createdBy,
              createdByName: invoice.createdByName,
              createdAt,
              syncStatus: invoice.syncStatus || "synced",
              lastSyncedAt: invoice.lastSyncedAt || null,
              metadata: { migratedFromLegacyInvoice: true },
            });
            invoice.latestVersionId = versionId;
          };

          addLegacyVersion("a4");
          addLegacyVersion("receipt");
          invoice.sourceId = sourceId;
          invoice.latestVersionNumber = versionNumber;
        }

        if (invoices.length > 0) await tx.table("invoices").bulkPut(invoices);
        if (legacyVersions.length > 0) await tx.table("invoice_versions").bulkPut(legacyVersions);
      });

    this.version(80).upgrade(async (tx) => {
      const [loanRows, installmentRows, workspaceRows] = await Promise.all([
        tx.table("loans").toArray() as Promise<Array<Record<string, unknown>>>,
        tx.table("loan_installments").toArray() as Promise<Array<Record<string, unknown>>>,
        tx.table("workspaces").toArray() as Promise<Array<Record<string, unknown>>>,
      ]);
      if (loanRows.length === 0) return;

      const localWorkspaceIds = new Set(
        workspaceRows
          .filter((row) => row.data_mode === "local" || row.data_mode === "demo")
          .map((row) => row.id)
          .filter((id): id is string => typeof id === "string"),
      );
      const activeInstallmentLoanIds = new Set(
        installmentRows
          .filter((row) => row.isDeleted !== true && typeof row.loanId === "string")
          .map((row) => row.loanId as string),
      );
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const backfilledInstallments: Array<Record<string, unknown>> = [];
      const updatedLoans: Array<Record<string, unknown>> = [];

      for (const loan of loanRows) {
        const loanId = typeof loan.id === "string" ? loan.id : "";
        const workspaceId = typeof loan.workspaceId === "string" ? loan.workspaceId : "";
        if (
          !loanId ||
          !workspaceId ||
          (!localWorkspaceIds.has(workspaceId) && !isLocalWorkspaceMode(workspaceId)) ||
          loan.isDeleted === true ||
          loan.source !== "order" ||
          loan.loanCategory !== "simple" ||
          activeInstallmentLoanIds.has(loanId)
        ) {
          continue;
        }

        const principalAmount = Math.max(0, Number(loan.principalAmount || 0));
        const paidAmount = Math.max(0, Number(loan.totalPaidAmount || 0));
        const balanceAmount = Math.max(
          0,
          Number(
            loan.balanceAmount ??
              Math.max(principalAmount - paidAmount, 0),
          ),
        );
        const firstDueDate = typeof loan.firstDueDate === "string" && loan.firstDueDate
          ? loan.firstDueDate.slice(0, 10)
          : null;
        const installmentStatus = balanceAmount <= 0
          ? "paid"
          : paidAmount > 0
            ? "partial"
            : firstDueDate && firstDueDate < today
              ? "overdue"
              : "unpaid";

        backfilledInstallments.push({
          id: crypto.randomUUID(),
          workspaceId,
          loanId,
          installmentNo: 1,
          dueDate: firstDueDate,
          plannedAmount: principalAmount,
          paidAmount,
          balanceAmount,
          status: installmentStatus,
          paidAt: installmentStatus === "paid"
            ? (typeof loan.updatedAt === "string" ? loan.updatedAt : now)
            : null,
          createdAt: typeof loan.createdAt === "string" ? loan.createdAt : now,
          updatedAt: now,
          syncStatus: "synced",
          lastSyncedAt: now,
          version: 1,
          isDeleted: false,
        });

        updatedLoans.push({
          ...loan,
          installmentCount: 1,
          nextDueDate: balanceAmount > 0 ? firstDueDate : null,
          status: balanceAmount <= 0
            ? "completed"
            : firstDueDate && firstDueDate < today
              ? "overdue"
              : "active",
          updatedAt: now,
          version: Number(loan.version || 0) + 1,
          syncStatus: "synced",
          lastSyncedAt: now,
        });
        activeInstallmentLoanIds.add(loanId);
      }

      if (backfilledInstallments.length > 0) {
        await tx.table("loan_installments").bulkPut(backfilledInstallments);
      }
      if (updatedLoans.length > 0) {
        await tx.table("loans").bulkPut(updatedLoans);
      }
    });

    this.version(81).stores({
      products:
        "id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned, [workspaceId+name], [workspaceId+sku], [workspaceId+categoryId], [workspaceId+currency], [workspaceId+updatedAt], [workspaceId+storageId]",
      categories:
        "id, name, workspaceId, syncStatus, updatedAt, isDeleted, [workspaceId+name], [workspaceId+updatedAt]",
      storages:
        "id, name, workspaceId, isSystem, isProtected, isPrimary, isMarketplace, syncStatus, updatedAt, isDeleted, [workspaceId+name], [workspaceId+updatedAt]",
      inventory:
        "id, workspaceId, productId, storageId, quantity, syncStatus, updatedAt, isDeleted, [workspaceId+storageId], [workspaceId+productId], [productId+storageId], [workspaceId+storageId+productId], [workspaceId+updatedAt]",
      stock_batches:
        "id, workspaceId, productId, storageId, batchNumber, expiryDate, sourcePurchaseOrderId, sourcePurchaseOrderItemId, updatedAt, isDeleted, [workspaceId+productId], [productId+storageId], [workspaceId+storageId], [workspaceId+storageId+productId], [workspaceId+updatedAt], [sourcePurchaseOrderId+sourcePurchaseOrderItemId]",
    });

    this.version(82).stores({
      order_returns:
        "id, workspaceId, orderId, status, returnedAt, updatedAt, isDeleted, syncStatus, [workspaceId+orderId], [workspaceId+returnedAt]",
      order_return_items:
        "id, workspaceId, returnId, orderId, orderItemId, updatedAt, isDeleted, syncStatus, [returnId+orderItemId], [workspaceId+orderId], [workspaceId+orderItemId]",
    });

    this.version(83).stores({
      business_partners:
        "id, name, workspaceId, role, customerFacetId, supplierFacetId, agentFacetId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId, latitude, longitude",
    });

    this.version(84)
      .stores({
        agents:
          "id, workspaceId, businessPartnerId, agentType, status, linkedUserId, updatedAt, isDeleted, syncStatus, [workspaceId+status], [workspaceId+agentType]",
      })
      .upgrade(async (tx) => {
        const agents = (await tx.table("agents").toArray()) as Array<
          Record<string, unknown>
        >;
        for (const agent of agents) {
          delete agent.imageUrl;
          delete agent.image_url;
        }
        if (agents.length > 0) {
          await tx.table("agents").bulkPut(agents);
        }

        const stripLegacyAgentImage = (row: Record<string, unknown>, field: "payload" | "data") => {
          const current = row[field];
          if (!current || typeof current !== "object" || Array.isArray(current)) {
            return row;
          }

          const next = { ...(current as Record<string, unknown>) };
          delete next.imageUrl;
          delete next.image_url;
          return { ...row, [field]: next };
        };

        const offlineMutations = (await tx
          .table("offline_mutations")
          .where("entityType")
          .equals("agents")
          .toArray()) as Array<Record<string, unknown>>;
        if (offlineMutations.length > 0) {
          await tx
            .table("offline_mutations")
            .bulkPut(offlineMutations.map((row) => stripLegacyAgentImage(row, "payload")));
        }

        const syncQueue = (await tx
          .table("syncQueue")
          .where("entityType")
          .equals("agents")
          .toArray()) as Array<Record<string, unknown>>;
        if (syncQueue.length > 0) {
          await tx
            .table("syncQueue")
            .bulkPut(syncQueue.map((row) => stripLegacyAgentImage(row, "data")));
        }
      });

    this.version(85).stores({
      price_books:
        "id, name, workspaceId, syncStatus, updatedAt, isDeleted, [workspaceId+name], [workspaceId+updatedAt]",
      price_book_items:
        "id, workspaceId, priceBookId, productId, currency, syncStatus, updatedAt, isDeleted, [workspaceId+priceBookId], [workspaceId+productId], &[priceBookId+productId], [workspaceId+updatedAt]",
      business_partners:
        "id, name, workspaceId, role, customerFacetId, supplierFacetId, agentFacetId, priceBookId, defaultCurrency, updatedAt, isDeleted, syncStatus, mergedIntoBusinessPartnerId, latitude, longitude",
    });

    this.version(86)
      .stores({
        products:
          "id, sku, skuKey, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned, [workspaceId+name], [workspaceId+sku], [workspaceId+skuKey], [workspaceId+categoryId], [workspaceId+currency], [workspaceId+updatedAt], [workspaceId+storageId]",
      })
      .upgrade(async (tx) => {
        const products = (await tx.table("products").toArray()) as Array<
          Record<string, unknown>
        >;
        const productsToUpdate = products.filter((product) => {
          const sku = typeof product.sku === "string" ? product.sku : "";
          return product.skuKey !== normalizeProductSku(sku);
        }).map((product) => ({
          ...product,
          skuKey: normalizeProductSku(
            typeof product.sku === "string" ? product.sku : "",
          ),
        }));

        if (productsToUpdate.length > 0) {
          await tx.table("products").bulkPut(productsToUpdate);
        }
      });

    this.version(87).upgrade(async (tx) => {
      // Do not let records queued by earlier clients revive the retired cloud logs.
      const localOnlyEntityTypes = [
        "inventory_transactions",
        "inventory_transfer_transactions",
      ];

      await Promise.all([
        tx.table("offline_mutations").where("entityType").anyOf(localOnlyEntityTypes).delete(),
        tx.table("syncQueue").where("entityType").anyOf(localOnlyEntityTypes).delete(),
      ]);
    });

    this.version(88).stores({
      sale_product_exchanges:
        "id, workspaceId, saleId, returnId, returnSaleItemId, returnProductId, replacementProductId, replacementStorageId, status, exchangedAt, updatedAt, isDeleted, syncStatus, [workspaceId+saleId], [workspaceId+exchangedAt], [saleId+exchangedAt]",
    });

    this.version(89).stores({
      activity_catalog:
        "id, workspaceId, name, currency, isInfinite, isActive, updatedAt, isDeleted, syncStatus, [workspaceId+name], [workspaceId+isActive], [workspaceId+updatedAt]",
      activity_transactions:
        "id, workspaceId, transactionNo, status, currency, occurredAt, createdAt, updatedAt, isDeleted, syncStatus, [workspaceId+occurredAt], [workspaceId+status], [workspaceId+createdAt]",
      activity_transaction_lines:
        "id, workspaceId, transactionId, activityId, updatedAt, isDeleted, syncStatus, [transactionId+activityId], [workspaceId+transactionId], [workspaceId+activityId]",
    });

    this.version(90).stores({
      agent_excluded_categories:
        "id, workspaceId, agentId, categoryId, updatedAt, isDeleted, syncStatus, [workspaceId+agentId], [workspaceId+categoryId], [agentId+categoryId]",
    });

    this.version(91)
      .stores({
        sale_items: "id, workspaceId, saleId, productId, [workspaceId+saleId]",
      })
      .upgrade(async (tx) => {
        const sales = (await tx.table("sales").toArray()) as Array<
          Record<string, unknown>
        >;
        const workspaceIdBySaleId = new Map(
          sales
            .filter(
              (sale) =>
                typeof sale.id === "string" &&
                typeof sale.workspaceId === "string",
            )
            .map((sale) => [sale.id as string, sale.workspaceId as string]),
        );
        const saleItems = (await tx.table("sale_items").toArray()) as Array<
          Record<string, unknown>
        >;
        const backfilledItems: Array<Record<string, unknown>> = [];
        for (const item of saleItems) {
          const workspaceId =
            typeof item.saleId === "string"
              ? workspaceIdBySaleId.get(item.saleId)
              : undefined;
          if (!workspaceId || item.workspaceId === workspaceId) {
            continue;
          }
          backfilledItems.push({ ...item, workspaceId });
        }

        if (backfilledItems.length > 0) {
          await tx.table("sale_items").bulkPut(backfilledItems);
        }
      });

    this.version(92)
      .stores({
        sale_items: "id, workspaceId, saleId, productId, [workspaceId+saleId]",
      })
      .upgrade(async (tx) => {
        const sales = (await tx.table("sales").toArray()) as Array<
          Record<string, unknown>
        >;
        const createdAtBySaleId = new Map(
          sales
            .filter(
              (sale) =>
                typeof sale.id === "string" &&
                typeof sale.createdAt === "string",
            )
            .map((sale) => [sale.id as string, sale.createdAt as string]),
        );
        const saleItems = (await tx.table("sale_items").toArray()) as Array<
          Record<string, unknown>
        >;
        const backfilledItems: Array<Record<string, unknown>> = [];
        for (const item of saleItems) {
          const parentCreatedAt = typeof item.saleId === "string"
            ? createdAtBySaleId.get(item.saleId)
            : undefined;
          const createdAt = typeof item.createdAt === "string"
            ? item.createdAt
            : parentCreatedAt;
          const updatedAt = typeof item.updatedAt === "string"
            ? item.updatedAt
            : typeof item.returnedAt === "string"
              ? item.returnedAt
              : createdAt;

          // A sale always has createdAt, but leave an unexpectedly malformed
          // record untouched rather than falsely assigning the upgrade time.
          if (!createdAt || !updatedAt) {
            continue;
          }
          if (item.createdAt === createdAt && item.updatedAt === updatedAt) {
            continue;
          }
          backfilledItems.push({ ...item, createdAt, updatedAt });
        }

        if (backfilledItems.length > 0) {
          await tx.table("sale_items").bulkPut(backfilledItems);
        }
      });

    this.version(93).stores({
      units:
        "id, workspaceId, code, updatedAt, isDeleted, syncStatus, [workspaceId+code], [workspaceId+updatedAt]",
    });

    this.version(94).stores({
      products:
        "id, sku, skuKey, name, categoryId, storageId, workspaceId, parentProductId, currency, syncStatus, updatedAt, isDeleted, canBeReturned, [workspaceId+name], [workspaceId+sku], [workspaceId+skuKey], [workspaceId+parentProductId], [workspaceId+categoryId], [workspaceId+currency], [workspaceId+updatedAt], [workspaceId+storageId]",
    });

    this.registerLocalModeSqliteAuthority();
    this.registerLocalModeSyncHooks();
  }

  private registerLocalModeSqliteAuthority() {
    const database = this;

    this.use({
      stack: "dbcore",
      name: "LocalModeSqliteAuthority",
      level: 1,
      create(down: DBCore) {
        return {
          ...down,
          table(tableName: string) {
            const downTable = down.table(tableName);
            if (!isMirroredSqliteTable(tableName)) {
              return downTable;
            }

            return {
              ...downTable,
              mutate(request: DBCoreMutateRequest) {
                return readRowsBeforeMutation(downTable, request).then((rows) =>
                  downTable.mutate(request).then((response) => {
                    const successfulRows = successfulMutationRows(
                      request,
                      response,
                      rows,
                    );
                    const mutations = buildSqliteMutations(
                      tableName,
                      request,
                      successfulRows,
                    );
                    if (mutations.length === 0) {
                      return response;
                    }

                    const context = localModeSqliteTransactions.get(
                      request.trans as object,
                    );
                    if (context) {
                      context.mutations.push(...mutations);
                      return response;
                    }

                    return Dexie.waitFor(
                      commitLocalModeSqliteMutations(database, mutations),
                    ).then(
                      () => response,
                      (error) => {
                        request.trans.abort();
                        throw error;
                      },
                    );
                  }),
                );
              },
            };
          },
        };
      },
    });

    const originalTransaction = this.transaction.bind(this) as (
      mode: string,
      ...args: unknown[]
    ) => Promise<unknown>;

    this.transaction = ((mode: string, ...args: unknown[]) => {
      const scope = args.pop();
      if (typeof scope !== "function") {
        return originalTransaction(mode, ...args, scope);
      }

      return originalTransaction(
        mode,
        ...args,
        async (transaction: Transaction) => {
          const isReadWrite = mode === "readwrite" || mode.startsWith("rw");
          const transactionKey = (
            transaction as Transaction & { idbtrans?: object }
          ).idbtrans;
          if (!isReadWrite || !transactionKey) {
            return scope(transaction);
          }

          const existingContext = localModeSqliteTransactions.get(transactionKey);
          if (existingContext) {
            return scope(transaction);
          }

          const context: LocalModeSqliteTransactionContext = { mutations: [] };
          localModeSqliteTransactions.set(transactionKey, context);
          try {
            const result = await scope(transaction);
            if (context.mutations.length > 0) {
              await Dexie.waitFor(
                commitLocalModeSqliteMutations(database, context.mutations),
              );
            }
            return result;
          } catch (error) {
            try {
              transaction.abort();
            } catch {
              // The IndexedDB transaction may already be aborting.
            }
            throw error;
          } finally {
            localModeSqliteTransactions.delete(transactionKey);
          }
        },
      );
    }) as typeof this.transaction;
  }

  private registerLocalModeSyncHooks() {
    const database = this;
    const syncAwareTables = [
      "products",
      "product_barcodes",
      "price_books",
      "price_book_items",
      "categories",
      "units",
      "invoices",
      "invoice_versions",
      "users",
      "sales",
      "sales_exchange",
      "sale_returns",
      "sale_return_items",
      "sale_product_exchanges",
      "order_returns",
      "order_return_items",
      "workspaces",
      "storages",
      "inventory",
      "inventory_transactions",
      "stock_batches",
      "product_discounts",
      "category_discounts",
      "inventory_transfer_transactions",
      "reorder_transfer_rules",
      "suppliers",
      "customers",
      "agents",
      "fleet_vehicles",
      "fleet_vehicle_assignments",
      "business_partners",
      "business_partner_merge_candidates",
      "employees",
      "workspace_contacts",
      "loans",
      "loan_installments",
      "loan_payments",
      "payment_transactions",
      "sales_orders",
      "purchase_orders",
      "order_installments",
      "travel_agency_sales",
      "real_estate_transactions",
      "real_estate_installments",
      "real_estate_payments",
      "exchange_pair_prices",
      "exchange_transactions",
      "exchange_fee_rules",
      "fx_safes",
      "fx_safe_balances",
      "fx_safe_movements",
      "clinical_appointments",
      "clinical_patients",
      "clinical_attachments",
      "clinical_presets",
      "budget_settings",
      "budget_allocations",
      "expense_series",
      "expense_items",
      "payroll_statuses",
      "dividend_statuses",
    ] as const;

    const normalizeSyncMetadata = (workspaceId?: string | null) => {
      if (!workspaceId || !isLocalWorkspaceMode(workspaceId)) {
        return null;
      }

      return {
        syncStatus: "synced",
        lastSyncedAt: new Date().toISOString(),
      };
    };

    for (const tableName of syncAwareTables) {
      const table = this.table(tableName);

      table.hook("creating", function (_primaryKey, obj) {
        if (!obj || typeof obj !== "object") {
          return;
        }

        const normalized = normalizeSyncMetadata(
          (obj as { workspaceId?: string }).workspaceId,
        );
        if (normalized) {
          Object.assign(obj, normalized);
        }

        this.onsuccess = () => {
          queueLocalModeSqliteUpsert(
            database,
            tableName,
            obj as Record<string, unknown>,
          );
        };
      });

      table.hook("updating", function (mods, _primaryKey, obj) {
        const nextWorkspaceId = (mods as { workspaceId?: unknown }).workspaceId;
        const normalized = normalizeSyncMetadata(
          typeof nextWorkspaceId === "string"
            ? nextWorkspaceId
            : (obj as { workspaceId?: string } | undefined)?.workspaceId,
        );

        this.onsuccess = (updatedObj) => {
          queueLocalModeSqliteUpsert(
            database,
            tableName,
            updatedObj as Record<string, unknown>,
          );
        };

        if (!normalized) {
          return mods;
        }

        return {
          ...mods,
          ...normalized,
        };
      });

      table.hook("deleting", function (_primaryKey, obj) {
        if (!obj || typeof obj !== "object") {
          return;
        }

        this.onsuccess = () => {
          queueLocalModeSqliteDelete(
            database,
            tableName,
            obj as Record<string, unknown>,
          );
        };
      });
    }

    for (const tableName of LOCAL_MODE_SQLITE_TABLES) {
      if (
        syncAwareTables.includes(tableName as (typeof syncAwareTables)[number])
      ) {
        continue;
      }

      const table = this.table(tableName);

      table.hook("creating", function (_primaryKey, obj) {
        if (!obj || typeof obj !== "object") {
          return;
        }

        this.onsuccess = () => {
          queueLocalModeSqliteUpsert(
            database,
            tableName,
            obj as Record<string, unknown>,
          );
        };
      });

      table.hook("updating", function (_mods, _primaryKey, _obj) {
        this.onsuccess = (updatedObj) => {
          queueLocalModeSqliteUpsert(
            database,
            tableName,
            updatedObj as Record<string, unknown>,
          );
        };
      });

      table.hook("deleting", function (_primaryKey, obj) {
        if (!obj || typeof obj !== "object") {
          return;
        }

        this.onsuccess = () => {
          queueLocalModeSqliteDelete(
            database,
            tableName,
            obj as Record<string, unknown>,
          );
        };
      });
    }
  }
}

// Singleton database instance
export const db = new AtlasDatabase();

// Database utility functions
export async function clearDatabase(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.products,
      db.product_barcodes,
      db.price_books,
      db.price_book_items,
      db.inventory,
      db.inventory_transactions,
      db.stock_batches,
      db.product_discounts,
      db.category_discounts,
      db.inventory_transfer_transactions,
      db.reorder_transfer_rules,
      db.categories,
      db.invoices,
      db.invoice_versions,
      db.travel_agency_sales,
      db.real_estate_transactions,
      db.real_estate_installments,
      db.real_estate_payments,
      db.activity_catalog,
      db.activity_transactions,
      db.activity_transaction_lines,
      db.exchange_pair_prices,
      db.exchange_transactions,
      db.exchange_fee_rules,
      db.fx_safes,
      db.fx_safe_balances,
      db.fx_safe_movements,
      db.clinical_appointments,
      db.clinical_patients,
      db.clinical_attachments,
      db.clinical_presets,
      db.manual_entry_templates,
      db.manual_entries,
      db.fleet_vehicles,
      db.fleet_vehicle_assignments,
      db.payment_transactions,
      db.order_installments,
      db.order_returns,
      db.order_return_items,
      db.sale_product_exchanges,
      db.syncQueue,
    ],
    async () => {
      await db.products.clear();
      await db.product_barcodes.clear();
      await db.price_books.clear();
      await db.price_book_items.clear();
      await db.inventory.clear();
      await db.inventory_transactions.clear();
      await db.stock_batches.clear();
      await db.product_discounts.clear();
      await db.category_discounts.clear();
      await db.inventory_transfer_transactions.clear();
      await db.reorder_transfer_rules.clear();
      await db.categories.clear();
      await db.invoices.clear();
      await db.invoice_versions.clear();
      await db.travel_agency_sales.clear();
      await db.real_estate_transactions.clear();
      await db.real_estate_installments.clear();
      await db.real_estate_payments.clear();
      await db.activity_catalog.clear();
      await db.activity_transactions.clear();
      await db.activity_transaction_lines.clear();
      await db.exchange_pair_prices.clear();
      await db.exchange_transactions.clear();
      await db.exchange_fee_rules.clear();
      await db.fx_safes.clear();
      await db.fx_safe_balances.clear();
      await db.fx_safe_movements.clear();
      await db.clinical_appointments.clear();
      await db.clinical_patients.clear();
      await db.clinical_attachments.clear();
      await db.clinical_presets.clear();
      await db.manual_entry_templates.clear();
      await db.manual_entries.clear();
      await db.fleet_vehicles.clear();
      await db.fleet_vehicle_assignments.clear();
      await db.payment_transactions.clear();
      await db.order_installments.clear();
      await db.order_returns.clear();
      await db.order_return_items.clear();
      await db.sale_product_exchanges.clear();
      await db.syncQueue.clear();
    },
  );
}

export async function exportDatabase(): Promise<{
  products: Product[];
  invoices: Invoice[];
}> {
  const [products, invoices] = await Promise.all([
    db.products
      .where("isDeleted")
      .equals(false as any)
      .toArray(),
    db.invoices
      .where("isDeleted")
      .equals(false as any)
      .toArray(),
  ]);

  return { products, invoices };
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
  return await db.syncQueue.count();
}
