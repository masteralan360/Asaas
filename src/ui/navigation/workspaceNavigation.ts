import type { TFunction } from "i18next";
import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Building2,
  Calculator,
  Copy,
  CreditCard,
  FileSpreadsheet,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Monitor,
  Package,
  Percent,
  Plane,
  Receipt,
  Settings,
  Store,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  UsersRound,
  Upload,
  Warehouse,
  Wallet,
  Zap,
} from "lucide-react";
import type { WorkspaceFeatures } from "@/workspace";
import type { ModuleFeatureKey } from "@/workspace/WorkspaceContext";
import type { WorkspacePermissionKey } from "@/permissions";

export interface WorkspaceNavigationChild {
  name: string;
  href: string;
  icon?: LucideIcon;
}

export interface WorkspaceNavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
  status?: string;
  alert?: boolean;
  mobileOnly?: boolean;
  children?: WorkspaceNavigationChild[];
}

export interface WorkspaceNavigationGroup {
  title: string;
  items: WorkspaceNavigationItem[];
  icon: LucideIcon;
}

export interface FlattenedWorkspaceNavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
  mobileOnly?: boolean;
  parentHref?: string;
}

interface BuildWorkspaceNavigationOptions {
  t: TFunction;
  role?: string;
  hasFeature: (feature: ModuleFeatureKey) => boolean;
  hasPermission?: (permission: WorkspacePermissionKey) => boolean;
  features: WorkspaceFeatures;
  isDesktopDevice: boolean;
  whatsappStatus?: "live" | "off";
}

import {
  launcherSectionOrder,
  launcherSections,
  moduleMetaByHref,
  type NavigationSectionKey,
} from "./navigationMeta";

export function buildWorkspaceNavigation({
  t,
  role,
  hasFeature,
  hasPermission,
  features,
  isDesktopDevice,
  whatsappStatus,
}: BuildWorkspaceNavigationOptions): WorkspaceNavigationGroup[] {
  const isCoreRole = role === "admin" || role === "staff" || role === "viewer";
  const canAccessPermission = hasPermission ?? (() => true);

  const canUseEcommerce =
    features.data_mode !== "local" && hasFeature("ecommerce");

  // 1. Define all possible individual navigation items with their visibility logic
  const dashboardItem: WorkspaceNavigationItem = {
    name: t("nav.dashboard", { defaultValue: "Dashboard" }),
    href: "/",
    icon: LayoutDashboard,
  };

  const otherItems: WorkspaceNavigationItem[] = [
    ...(isCoreRole && hasFeature("pos")
      ? [
          {
            name: t("nav.pos", { defaultValue: "Point of Sale" }),
            href: "/pos",
            icon: CreditCard,
          },
        ]
      : []),
    ...(isCoreRole && hasFeature("instant_pos") && features.instant_pos
      ? [
          {
            name: t("nav.instantPos", { defaultValue: "Instant POS" }),
            href: "/instant-pos",
            icon: Zap,
            children: features.kds_enabled ? [
              {
                name: t("nav.kdsDashboard", { defaultValue: "KDS Dashboard" }),
                href: "/kds",
                icon: Monitor,
              },
            ] : undefined,
          },
        ]
      : []),
    ...(hasFeature("sales_history")
      ? [
          {
            name: t("nav.sales", { defaultValue: "Sales History" }),
            href: "/sales",
            icon: Receipt,
          },
        ]
      : []),
    ...(isCoreRole && hasFeature("crm")
      ? [
          ...(canAccessPermission("businessPartners.access")
            ? [
                {
                  name: t("businessPartners.title", {
                    defaultValue: "Business Partners",
                  }),
                  href: "/business-partners",
                  icon: UsersRound,
                },
              ]
            : []),
          ...(canAccessPermission("customers.access")
            ? [
                {
                  name: t("nav.customers", { defaultValue: "Customers" }),
                  href: "/customers",
                  icon: Users,
                },
              ]
            : []),
          ...(canAccessPermission("suppliers.access")
            ? [
                {
                  name: t("nav.suppliers", { defaultValue: "Suppliers" }),
                  href: "/suppliers",
                  icon: Truck,
                },
              ]
            : []),
          ...(canAccessPermission("orders.access")
            ? [
                {
                  name: t("nav.orders", { defaultValue: "Orders" }),
                  href: "/orders",
                  icon: ShoppingCart,
                },
              ]
            : []),
        ]
      : []),
    ...(isCoreRole && canUseEcommerce && canAccessPermission("ecommerce.access")
      ? [
          {
            name: t("nav.ecommerce", { defaultValue: "E-Commerce" }),
            href: "/ecommerce",
            icon: Store,
          },
        ]
      : []),
    ...(isCoreRole && hasFeature("travel_agency")
      ? [
          {
            name: t("nav.travelAgency", { defaultValue: "Travel Agency" }),
            href: "/travel-agency",
            icon: Plane,
          },
        ]
      : []),
    ...(isCoreRole && hasFeature("real_estate") && canAccessPermission("realEstate.access")
      ? [
          {
            name: t("realEstate.title", { defaultValue: "Real Estate" }),
            href: "/real-estate",
            icon: Building2,
          },
        ]
      : []),
    ...(hasFeature("loans") || hasFeature("installments") || hasFeature("real_estate")
      ? [
          ...(canAccessPermission("loans.access")
            && hasFeature("loans")
            ? [
                {
                  name: t("nav.loans", { defaultValue: "Loans" }),
                  href: "/loans",
                  icon: HandCoins,
                },
              ]
            : []),
          ...((hasFeature("installments") || hasFeature("real_estate"))
            && canAccessPermission("installments.access")
            ? [
                {
                  name: t("nav.installments", {
                    defaultValue: t("loans.title", { defaultValue: "Installments" }),
                  }),
                  href: "/installments",
                  icon: Copy,
                },
              ]
            : []),
        ]
      : []),
    ...(isCoreRole
      ? [
          ...(hasFeature("ledger") && canAccessPermission("ledger.access")
            ? [
                {
                  name: t("nav.ledger", { defaultValue: "Ledger" }),
                  href: "/ledger",
                  icon: Wallet,
                },
              ]
            : []),
          ...(hasFeature("payments") && canAccessPermission("payment.access")
            ? [
                {
                  name: t("nav.payments", { defaultValue: "Payments" }),
                  href: "/payments",
                  icon: CreditCard,
                },
              ]
            : []),
          ...(hasFeature("direct_transactions") && canAccessPermission("directTransaction.access")
            ? [
                {
                  name: t("nav.directTransactions", {
                    defaultValue: "Direct Transactions",
                  }),
                  href: "/direct-transactions",
                  icon: ArrowRightLeft,
                },
              ]
            : []),
          ...(hasFeature("net_revenue") && canAccessPermission("revenueAnalytics.access")
            ? [
                {
                  name: t("nav.revenue", { defaultValue: "Revenue Analytics" }),
                  href: "/revenue",
                  icon: BarChart3,
                },
              ]
            : []),
          ...(hasFeature("budget") && canAccessPermission("accounting.access")
            ? [
                {
                  name: t("nav.budget", { defaultValue: "Accounting" }),
                  href: "/budget",
                  icon: FileSpreadsheet,
                },
              ]
            : []),
          ...(hasFeature("monthly_comparison")
            ? [
                {
                  name: t("monthlyComparison.title", {
                    defaultValue: "Monthly Comparison",
                  }),
                  href: "/monthly-comparison",
                  icon: ArrowRightLeft,
                },
              ]
            : []),
          ...(hasFeature("team_performance") && canAccessPermission("teamPerformance.access")
            ? [
                {
                  name: t("nav.performance", {
                    defaultValue: "Team Performance",
                  }),
                  href: "/performance",
                  icon: TrendingUp,
                },
              ]
            : []),
        ]
      : []),
    ...(features.allowed_currencies.length > 1
      ? [
          {
            name: t("nav.currencyConverter", { defaultValue: "Currency Converter" }),
            href: "/currency-converter",
            icon: Calculator,
            mobileOnly: true,
          },
        ]
      : []),
    ...(isCoreRole && hasFeature("allow_whatsapp") && isDesktopDevice
      ? [
          {
            name: t("nav.whatsapp", { defaultValue: "WhatsApp" }),
            href: "/whatsapp",
            icon: MessageSquare,
            status: whatsappStatus,
          },
        ]
      : []),
    ...(hasFeature("products")
      ? [
          {
            name: t("nav.products", { defaultValue: "Products" }),
            href: "/products",
            icon: Package,
          },
        ]
      : []),
    ...(hasFeature("discounts") && canAccessPermission("discounts.access")
      ? [
          {
            name: t("nav.discounts", { defaultValue: "Discounts" }),
            href: "/discounts",
            icon: Percent,
          },
        ]
      : []),
    ...(hasFeature("storages") && canAccessPermission("storages.access")
      ? [
          {
            name: t("nav.storages", { defaultValue: "Storages" }),
            href: "/storages",
            icon: Warehouse,
          },
        ]
      : []),
    ...(hasFeature("inventory_transfer") && canAccessPermission("inventoryTransfer.access")
      ? [
          {
            name: t("nav.inventoryTransfer", {
              defaultValue: "Inventory Transfer",
            }),
            href: "/inventory-transfer",
            icon: ArrowRightLeft,
          },
        ]
      : []),
    ...(hasFeature("inventory_transfer") && canAccessPermission("inventoryTransactions.access")
      ? [
          {
            name: t("nav.inventoryTransactions", {
              defaultValue: "Inventory Transactions",
            }),
            href: "/inventory-transactions",
            icon: History,
          },
        ]
      : []),
    ...(hasFeature("stock_adjustments") && canAccessPermission("stockAdjustments.access")
      ? [
          {
            name: t("nav.stockAdjustments", {
              defaultValue: "Stock Adjustments",
            }),
            href: "/stock-adjustments",
            icon: Boxes,
          },
        ]
      : []),
    ...(hasFeature("invoices_history") && canAccessPermission("invoiceHistory.access")
      ? [
          {
            name: t("nav.invoicesHistory", {
              defaultValue: "Invoices History",
            }),
            href: "/invoices-history",
            icon: FileText,
            children: [
              {
                name: t("nav.uploadFiles", { defaultValue: "Upload Files" }),
                href: "/invoices-history/upload-files",
                icon: Upload,
              },
            ],
          },
        ]
      : []),
    ...(isCoreRole
      ? [
          ...(hasFeature("hr") && canAccessPermission("hr.access")
            ? [
                {
                  name: t("nav.hr", { defaultValue: "HR" }),
                  href: "/hr",
                  icon: UsersRound,
                },
              ]
            : []),
          ...(hasFeature("members")
            ? [
                {
                  name: t("members.adminControlTitle", { defaultValue: "Members & Admin Control" }),
                  href: "/members",
                  icon: Users,
                },
              ]
            : []),
          ...(role === "admin"
            ? [
                {
                  name: t("customTemplates.title", { defaultValue: "Custom Templates" }),
                  href: "/custom-templates",
                  icon: FileText,
                },
              ]
            : []),
          {
            name: t("nav.settings", { defaultValue: "Settings" }),
            href: "/settings",
            icon: Settings,
          },
        ]
      : []),
  ];

  // 2. Group items into launcher-style sections
  const grouped = new Map<NavigationSectionKey, WorkspaceNavigationItem[]>();

  otherItems.forEach((item) => {
    const meta = moduleMetaByHref[item.href] || {
      section: "people-and-workspace" as const,
    };
    const sectionItems = grouped.get(meta.section) || [];
    sectionItems.push(item);
    grouped.set(meta.section, sectionItems);
  });

  // 3. Convert map back to ordered array of WorkspaceNavigationGroup
  const launcherGroups = launcherSectionOrder
    .map((key) => ({
      title: t(`nav.sections.${key}.title`, {
        defaultValue: launcherSections[key].title,
      }),
      icon: launcherSections[key].icon,
      items: grouped.get(key) || [],
    }))
    .filter((group) => group.items.length > 0);

  return [
    {
      title: "", // Standalone Dashboard has no group title
      icon: LayoutDashboard,
      items: [dashboardItem],
    },
    ...launcherGroups,
  ];
}

export function flattenWorkspaceNavigation(
  groups: WorkspaceNavigationGroup[],
): FlattenedWorkspaceNavigationItem[] {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => [
      {
        name: item.name,
        href: item.href,
        icon: item.icon,
        mobileOnly: item.mobileOnly,
      },
      ...(item.children || []).map((child) => ({
        name: child.name,
        href: child.href,
        icon: child.icon || item.icon,
        mobileOnly: item.mobileOnly,
        parentHref: item.href,
      })),
    ]),
  );
}
