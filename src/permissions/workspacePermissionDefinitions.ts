export const WORKSPACE_PERMISSION_DEFINITIONS = [
  {
    key: "payment.access",
    module: "payment",
    labelKey: "members.permissions.paymentAccess",
    defaultLabel: "Payment module",
    descriptionKey: "members.permissions.paymentAccessDescription",
    defaultDescription: "Access the central payments page.",
  },
  {
    key: "directTransaction.access",
    module: "directTransaction",
    labelKey: "members.permissions.directTransactionAccess",
    defaultLabel: "Direct Transaction module",
    descriptionKey: "members.permissions.directTransactionAccessDescription",
    defaultDescription: "Access manual incoming and outgoing transactions.",
  },
  {
    key: "businessPartners.access",
    module: "businessPartners",
    labelKey: "members.permissions.businessPartnersAccess",
    defaultLabel: "Business Partners",
    descriptionKey: "members.permissions.businessPartnersAccessDescription",
    defaultDescription: "Access business partner records and balances.",
  },
  {
    key: "customers.access",
    module: "customers",
    labelKey: "members.permissions.customersAccess",
    defaultLabel: "Customers",
    descriptionKey: "members.permissions.customersAccessDescription",
    defaultDescription: "Access customer records and details.",
  },
  {
    key: "suppliers.access",
    module: "suppliers",
    labelKey: "members.permissions.suppliersAccess",
    defaultLabel: "Suppliers",
    descriptionKey: "members.permissions.suppliersAccessDescription",
    defaultDescription: "Access supplier records and details.",
  },
  {
    key: "orders.access",
    module: "orders",
    labelKey: "members.permissions.ordersAccess",
    defaultLabel: "Orders",
    descriptionKey: "members.permissions.ordersAccessDescription",
    defaultDescription: "Access purchase and sales orders.",
  },
  {
    key: "ecommerce.access",
    module: "ecommerce",
    labelKey: "members.permissions.ecommerceAccess",
    defaultLabel: "E-Commerce",
    descriptionKey: "members.permissions.ecommerceAccessDescription",
    defaultDescription: "Access marketplace orders and e-commerce operations.",
  },
  {
    key: "accounting.access",
    module: "accounting",
    labelKey: "members.permissions.accountingAccess",
    defaultLabel: "Accounting",
    descriptionKey: "members.permissions.accountingAccessDescription",
    defaultDescription: "Access accounting records and budget controls.",
  },
  {
    key: "invoiceHistory.access",
    module: "invoiceHistory",
    labelKey: "members.permissions.invoiceHistoryAccess",
    defaultLabel: "Invoice History & Upload Files",
    descriptionKey: "members.permissions.invoiceHistoryAccessDescription",
    defaultDescription: "Access invoice history and uploaded invoice files.",
  },
  {
    key: "loans.access",
    module: "loans",
    labelKey: "members.permissions.loansAccess",
    defaultLabel: "Loans",
    descriptionKey: "members.permissions.loansAccessDescription",
    defaultDescription: "Access loan records and histories.",
  },
  {
    key: "installments.access",
    module: "installments",
    labelKey: "members.permissions.installmentsAccess",
    defaultLabel: "Installments",
    descriptionKey: "members.permissions.installmentsAccessDescription",
    defaultDescription: "Access installment schedules and collection flow.",
  },
  {
    key: "ledger.access",
    module: "ledger",
    labelKey: "members.permissions.ledgerAccess",
    defaultLabel: "Ledger",
    descriptionKey: "members.permissions.ledgerAccessDescription",
    defaultDescription: "Access ledger and cross-module financial trails.",
  },
  {
    key: "stockAdjustments.access",
    module: "stockAdjustments",
    labelKey: "members.permissions.stockAdjustmentsAccess",
    defaultLabel: "Stock Adjustments",
    descriptionKey: "members.permissions.stockAdjustmentsAccessDescription",
    defaultDescription: "Access stock adjustment records.",
  },
  {
    key: "inventoryTransactions.access",
    module: "inventoryTransactions",
    labelKey: "members.permissions.inventoryTransactionsAccess",
    defaultLabel: "Inventory Transactions",
    descriptionKey: "members.permissions.inventoryTransactionsAccessDescription",
    defaultDescription: "Access inventory movement and transaction logs.",
  },
  {
    key: "inventoryTransfer.access",
    module: "inventoryTransfer",
    labelKey: "members.permissions.inventoryTransferAccess",
    defaultLabel: "Inventory Transfer",
    descriptionKey: "members.permissions.inventoryTransferAccessDescription",
    defaultDescription: "Access inventory transfer workflows.",
  },
  {
    key: "storages.access",
    module: "storages",
    labelKey: "members.permissions.storagesAccess",
    defaultLabel: "Storages",
    descriptionKey: "members.permissions.storagesAccessDescription",
    defaultDescription: "Access warehouses and storage locations.",
  },
  {
    key: "discounts.access",
    module: "discounts",
    labelKey: "members.permissions.discountsAccess",
    defaultLabel: "Discounts",
    descriptionKey: "members.permissions.discountsAccessDescription",
    defaultDescription: "Access discount and promotion controls.",
  },
  {
    key: "revenueAnalytics.access",
    module: "revenueAnalytics",
    labelKey: "members.permissions.revenueAnalyticsAccess",
    defaultLabel: "Revenue Analytics",
    descriptionKey: "members.permissions.revenueAnalyticsAccessDescription",
    defaultDescription: "Access revenue analytics and reporting.",
  },
  {
    key: "teamPerformance.access",
    module: "teamPerformance",
    labelKey: "members.permissions.teamPerformanceAccess",
    defaultLabel: "Team Performance",
    descriptionKey: "members.permissions.teamPerformanceAccessDescription",
    defaultDescription: "Access team performance reporting.",
  },
  {
    key: "hr.access",
    module: "hr",
    labelKey: "members.permissions.hrAccess",
    defaultLabel: "HR",
    descriptionKey: "members.permissions.hrAccessDescription",
    defaultDescription: "Access HR records and workflows.",
  },
] as const;

export type WorkspacePermissionKey =
  (typeof WORKSPACE_PERMISSION_DEFINITIONS)[number]["key"];

const supportedPermissionKeys = new Set<string>(
  WORKSPACE_PERMISSION_DEFINITIONS.map((permission) => permission.key),
);

export function isSupportedWorkspacePermissionKey(
  key: string,
): key is WorkspacePermissionKey {
  return supportedPermissionKeys.has(key);
}

export function getWorkspacePermissionModule(key: string) {
  return key.split(".")[0] || key;
}
