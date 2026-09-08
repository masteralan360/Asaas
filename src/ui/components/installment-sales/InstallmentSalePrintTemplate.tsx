import { useTranslation } from "react-i18next";

import type { InstallmentSale, InstallmentSaleInstallment } from "@/local-db";
import { formatCurrency, formatDate } from "@/lib/utils";

type InstallmentSalePrintTemplateProps = {
  workspaceName?: string | null;
  sale: InstallmentSale;
  installments: InstallmentSaleInstallment[];
  iqdPreference: Parameters<typeof formatCurrency>[2];
  qrValue?: string;
};

const ROWS_PER_A4_PAGE = 12;

export function InstallmentSalePrintTemplate({
  workspaceName,
  sale,
  installments,
  iqdPreference,
  qrValue,
}: InstallmentSalePrintTemplateProps) {
  const { t } = useTranslation();
  const isNoFrequency = sale.installmentFrequency === "no_frequency";
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(installments.length / ROWS_PER_A4_PAGE)) },
    (_, index) =>
      installments.slice(
        index * ROWS_PER_A4_PAGE,
        (index + 1) * ROWS_PER_A4_PAGE,
      ),
  );

  return (
    <div className="bg-white text-black">
      {pages.map((rows, pageIndex) => (
        <section
          key={pageIndex}
          className="mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white px-[14mm] py-[13mm] text-[11px]"
          style={{ breakAfter: pageIndex < pages.length - 1 ? "page" : "auto" }}
        >
          <header className="flex items-start justify-between border-b-2 border-black pb-4">
            <div>
              <h1 className="text-xl font-bold">{workspaceName || ""}</h1>
              <div className="mt-1 text-sm font-semibold">
                {t("installmentSales.title")}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold">{sale.saleNo}</div>
              <div className="mt-1 text-xs">{formatDate(sale.createdAt)}</div>
            </div>
          </header>
          <div className="py-5">
            <div>
              <div className="text-[10px] uppercase text-zinc-500">
                {t("installmentSales.customer")}
              </div>
              <div className="font-semibold">{sale.customerNameSnapshot}</div>
            </div>
            <div className="mt-4">
              <div className="text-[10px] uppercase text-zinc-500">
                {t("installmentSales.description")}
              </div>
              <div>{sale.description}</div>
            </div>
          </div>
          {pageIndex === 0 ? (
            <div className="grid grid-cols-3 gap-3 border-y py-4">
              <Summary
                label={t("installmentSales.totalSalePrice")}
                value={formatCurrency(
                  sale.totalSalePrice,
                  sale.currency,
                  iqdPreference,
                )}
              />
              <Summary
                label={t("installmentSales.downPayment")}
                value={formatCurrency(
                  sale.downPaymentAmount,
                  sale.currency,
                  iqdPreference,
                )}
              />
              <Summary
                label={t("installmentSales.grossProfit")}
                value={formatCurrency(
                  sale.grossProfit,
                  sale.currency,
                  iqdPreference,
                )}
              />
            </div>
          ) : null}
          <div className="mt-5 flex-1">
            {isNoFrequency ? (
              <>
                <h2 className="mb-3 text-sm font-bold">
                  {t("installmentSales.repaymentSummary")}
                </h2>
                <div className="grid grid-cols-3 gap-3 border-y py-4">
                  <Summary
                    label={t("installmentSales.totalSalePrice")}
                    value={formatCurrency(
                      sale.totalSalePrice,
                      sale.currency,
                      iqdPreference,
                    )}
                  />
                  <Summary
                    label={t("installmentSales.paid")}
                    value={formatCurrency(
                      sale.customerPaidAmount,
                      sale.currency,
                      iqdPreference,
                    )}
                  />
                  <Summary
                    label={t("installmentSales.customerReceivable")}
                    value={formatCurrency(
                      sale.customerBalanceAmount,
                      sale.currency,
                      iqdPreference,
                    )}
                  />
                </div>
              </>
            ) : <>
              <h2 className="mb-3 text-sm font-bold">
                {t("loans.installmentSchedule")}
              </h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-black text-left">
                  <th className="py-2">{t("installmentSales.installment")}</th>
                  <th className="py-2">{t("installmentSales.dueDate")}</th>
                  <th className="py-2 text-right">
                    {t("installmentSales.planned")}
                  </th>
                  <th className="py-2 text-right">
                    {t("installmentSales.paid")}
                  </th>
                  <th className="py-2 text-right">
                    {t("installmentSales.balance")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-200"
                    style={{ breakInside: "avoid" }}
                  >
                    <td className="py-2">{row.installmentNo}</td>
                    <td className="py-2">{row.dueDate ? formatDate(row.dueDate) : "-"}</td>
                    <td className="py-2 text-right">
                      {formatCurrency(
                        row.plannedAmount,
                        sale.currency,
                        iqdPreference,
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {formatCurrency(
                        row.paidAmount,
                        sale.currency,
                        iqdPreference,
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {formatCurrency(
                        row.balanceAmount,
                        sale.currency,
                        iqdPreference,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>}
          </div>
          <footer className="mt-5 flex items-end justify-between border-t pt-3 text-[10px] text-zinc-500">
            <span>
              {t("installmentSales.customerReceivable")}:{" "}
              {formatCurrency(
                sale.customerBalanceAmount,
                sale.currency,
                iqdPreference,
              )}
            </span>
            <span>{qrValue || ""}</span>
            <span>
              {pageIndex + 1} / {pages.length}
            </span>
          </footer>
        </section>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  );
}
