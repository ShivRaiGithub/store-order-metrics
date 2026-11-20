import type { TableSpec } from "@/lib/charts";
import { ChartBubble, money, shortDate } from "./ChartBubble";

/** Returned orders: one row per returned line item. */
export function ReturnsTable({ spec }: { spec: TableSpec }) {
  return (
    <ChartBubble
      title={spec.title}
      subtitle={`${spec.rangeLabel} · by ${spec.dateBasis}`}
      summary={`${spec.totalUnits} ${spec.totalUnits === 1 ? "unit" : "units"} · ${money(spec.totalRefund)} refunded`}
    >
      {spec.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No returns in this period.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr className="border-b border-[var(--grid)]">
                <th className="px-1 py-2 font-medium">Returned</th>
                <th className="px-1 py-2 font-medium">Order</th>
                <th className="px-1 py-2 font-medium">Product</th>
                <th className="px-1 py-2 font-medium">Reason</th>
                <th className="px-1 py-2 text-right font-medium">Qty</th>
                <th className="px-1 py-2 text-right font-medium">Refund</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)]">
              {spec.rows.map((r) => (
                <tr key={`${r.orderId}-${r.productTitle}-${r.variant}`} className="border-b border-[var(--grid)] last:border-0">
                  <td className="whitespace-nowrap px-1 py-2">{shortDate(r.returnDate)}</td>
                  <td className="whitespace-nowrap px-1 py-2 text-[var(--text-secondary)]">
                    {r.orderId}
                    <span className="block text-xs text-[var(--text-muted)]">ordered {shortDate(r.orderDate)}</span>
                  </td>
                  <td className="px-1 py-2">
                    {r.productTitle}
                    <span className="block text-xs text-[var(--text-muted)]">{r.variant}</span>
                  </td>
                  <td className="px-1 py-2 text-[var(--text-secondary)]">{r.reason}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{money(r.refundAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--grid)] font-medium text-[var(--text-primary)]">
                <td className="px-1 py-2" colSpan={4}>
                  Total
                </td>
                <td className="px-1 py-2 text-right tabular-nums">{spec.totalUnits}</td>
                <td className="px-1 py-2 text-right tabular-nums">{money(spec.totalRefund)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ChartBubble>
  );
}
