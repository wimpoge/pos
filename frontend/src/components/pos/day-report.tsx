"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { StatCard, StatusBadge, Totals } from "@/components/pos/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe } from "@/lib/auth";
import { dateLabel, money, qty, timeLabel } from "@/lib/format";
import { METHOD_LABEL, type DayReport } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The end-of-day (Z) report: cards on screen, a plain ruled document on paper. Used on the Day
 * report page and on the till once it closes. */
export function DayReportView({ report }: { report: DayReport | undefined }) {
  return (
    <>
      <div className="contents print:hidden">
        <ScreenReport report={report} />
      </div>
      {report && <PaperPortal><PrintReport report={report} /></PaperPortal>}
    </>
  );
}

function ScreenReport({ report: r }: { report: DayReport | undefined }) {
  return (
    <>
  {!r ? (
    <Spinner className="mx-auto my-10" />
  ) : (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Net takings" value={money(r.net.total)} hint={`incl. PPN ${money(r.net.tax)}`} />
        <StatCard label="Sales" value={r.sales.count} hint={`${qty(r.sales.items)} items · ${money(r.sales.total)}`} />
        <StatCard
          label="Returns and voids"
          value={r.returns.count + r.returns.voids}
          hint={`${r.returns.count} return${r.returns.count === 1 ? "" : "s"} · ${r.returns.voids} void${r.returns.voids === 1 ? "" : "s"} · −${money(r.returns.total)}`}
          tone={r.returns.total ? "danger" : undefined}
        />
        <StatCard
          label="ERP"
          value={r.erp.waiting + r.erp.refused === 0 ? "All booked" : `${r.erp.waiting + r.erp.refused} open`}
          tone={r.erp.refused ? "danger" : r.erp.waiting ? undefined : "success"}
          hint={`${r.erp.waiting} waiting · ${r.erp.refused} refused`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <Totals
              full
              rows={[
                { label: "Sales before discount", value: money(r.sales.gross) },
                { label: "Discounts", value: r.sales.discount ? `−${money(r.sales.discount)}` : "—" },
                { label: "Sales before tax", value: money(r.sales.subtotal) },
                { label: "PPN", value: money(r.sales.tax) },
                { label: "Sales", value: money(r.sales.total) },
                { label: "Refunds", value: r.returns.total ? `−${money(r.returns.total)}` : "—" },
                { label: "Net takings", value: money(r.net.total), strong: true },
              ]}
            />
            {(r.points.earned > 0 || r.points.redeemed > 0 || r.sales.offline > 0) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {[
                  r.points.earned > 0 && `${qty(r.points.earned)} loyalty points earned`,
                  r.points.redeemed > 0 && `${qty(r.points.redeemed)} points spent`,
                  r.sales.offline > 0 && `${r.sales.offline} sale(s) rung up offline`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By payment method</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Taken</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.by_method.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell>{METHOD_LABEL[m.method]}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.taken)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.refunded ? `−${money(m.refunded)}` : "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(m.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Cash put in {money(r.cash.in)} · taken out {money(r.cash.out)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
        </CardHeader>
        <CardContent>
          {r.shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shift opened that day.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="hidden sm:table-cell print:table-cell">Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Over / short</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.number}</TableCell>
                    <TableCell>{s.cashier}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell print:table-cell">
                      {timeLabel(s.opened_at)}–{s.closed_at ? timeLabel(s.closed_at) : "now"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.auto_closed && s.counted_cash === null ? "not_counted" : s.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.expected_cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.counted_cash)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", s.variance && s.variance < 0 && "text-destructive")}>
                      {s.variance == null ? "—" : s.variance === 0 ? "Exact" : `${s.variance > 0 ? "+" : "−"}${money(Math.abs(s.variance))}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3 print:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>By cashier</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {r.by_cashier.map((c) => (
                <li key={c.name} className="flex justify-between gap-2">
                  <span>
                    {c.name} <span className="text-xs text-muted-foreground">· {c.sales} sale(s)</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {money(c.total)}
                    {c.refunds > 0 && <span className="block text-xs text-destructive">−{money(c.refunds)}</span>}
                  </span>
                </li>
              ))}
              {r.by_cashier.length === 0 && <li className="text-muted-foreground">No sales.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {r.top_products.map((p) => (
                <li key={p.sku} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="tabular-nums">{qty(p.qty)}×</span> {p.name}
                  </span>
                  <span className="tabular-nums">{money(p.total)}</span>
                </li>
              ))}
              {r.top_products.length === 0 && <li className="text-muted-foreground">No sales.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Promotions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {r.promotions.map((p) => (
                <li key={p.name} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {p.name} <span className="text-xs text-muted-foreground">· {p.lines} line(s)</span>
                  </span>
                  <span className="tabular-nums">−{money(p.discount)}</span>
                </li>
              ))}
              {r.promotions.length === 0 && <li className="text-muted-foreground">None used.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )}
    </>
  );
}

// ---------------------------------------------------------------- on paper

/** Paper gets the report alone: it is rendered straight into <body>, outside the app's sidebar and
 * scrolling layout, and globals.css hides everything else when printing. Only ever rendered once
 * the report has loaded, so always in the browser. */
function PaperPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="print-root">{children}</div>, document.body);
}

/** The report as a document: black on white, ruled tables, every figure on A4 portrait, and room to
 * sign for the drawer. Only shown when printing. */
function PrintReport({ report: r }: { report: DayReport }) {
  const me = useMe();
  const variance = (v: number | null) => (v == null ? "—" : v === 0 ? "Exact" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`);
  const head = "border-b border-black py-1 text-left text-[9pt] font-semibold";
  const cell = "border-b border-neutral-300 py-1";
  return (
    <article className="hidden bg-white font-sans text-[10.5pt] leading-snug text-black print:block">
      <style>{"@page { size: A4 portrait; margin: 14mm 12mm; }"}</style>
      <header className="mb-4 flex items-end justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-[9pt] uppercase tracking-wide">{me.company.name || "Store"} · Day report</p>
          <h1 className="text-[16pt] font-bold">{r.store.name}</h1>
        </div>
        <div className="text-right text-[9pt]">
          <p className="text-[12pt] font-semibold">{dateLabel(r.date)}</p>
          <p>
            Printed {new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} by {me.full_name}
          </p>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-6">
        <PrintSection title="Totals">
          <PaperTable
            rows={[
              ["Sales", `${r.sales.count}${r.sales.voided ? ` (${r.sales.voided} voided)` : ""} · ${qty(r.sales.items)} items`],
              ["Before discount", money(r.sales.gross)],
              ["Discounts", r.sales.discount ? `−${money(r.sales.discount)}` : "—"],
              ["Before tax", money(r.sales.subtotal)],
              ["PPN", money(r.sales.tax)],
              ["Sales total", money(r.sales.total)],
              [`Refunds (${r.returns.count} return${r.returns.count === 1 ? "" : "s"}, ${r.returns.voids} void${r.returns.voids === 1 ? "" : "s"})`, r.returns.total ? `−${money(r.returns.total)}` : "—"],
            ]}
            total={["Net takings", money(r.net.total)]}
          />
        </PrintSection>
        <PrintSection title="By payment method">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Method</th>
                <th className={`${head} text-right`}>Taken</th>
                <th className={`${head} text-right`}>Refunded</th>
                <th className={`${head} text-right`}>Net</th>
              </tr>
            </thead>
            <tbody>
              {r.by_method.map((m) => (
                <tr key={m.method}>
                  <td className={cell}>{METHOD_LABEL[m.method]}</td>
                  <td className={`${cell} text-right tabular-nums`}>{money(m.taken)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{m.refunded ? `−${money(m.refunded)}` : "—"}</td>
                  <td className={`${cell} text-right font-medium tabular-nums`}>{money(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[9pt]">
            Cash put in {money(r.cash.in)} · taken out {money(r.cash.out)}
            {r.points.earned || r.points.redeemed ? ` · points earned ${qty(r.points.earned)}, spent ${qty(r.points.redeemed)}` : ""}
          </p>
          <p className="text-[9pt]">
            ERP: {r.erp.waiting + r.erp.refused === 0 ? "everything booked" : `${r.erp.waiting} waiting, ${r.erp.refused} refused`}
            {r.sales.offline ? ` · ${r.sales.offline} sale(s) rung up offline` : ""}
          </p>
        </PrintSection>
      </div>

      <PrintSection title="Shifts">
        {r.shifts.length === 0 ? (
          <p>No shift opened that day.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Shift</th>
                <th className={head}>Cashier</th>
                <th className={head}>Hours</th>
                <th className={`${head} text-right`}>Float</th>
                <th className={`${head} text-right`}>Expected</th>
                <th className={`${head} text-right`}>Counted</th>
                <th className={`${head} text-right`}>Over / short</th>
              </tr>
            </thead>
            <tbody>
              {r.shifts.map((s) => (
                <tr key={s.id}>
                  <td className={`${cell} font-mono text-[9pt]`}>{s.number}</td>
                  <td className={cell}>{s.cashier}</td>
                  <td className={cell}>
                    {timeLabel(s.opened_at)}–{s.closed_at ? timeLabel(s.closed_at) : "still open"}
                  </td>
                  <td className={`${cell} text-right tabular-nums`}>{money(s.opening_float)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{money(s.expected_cash)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{money(s.counted_cash)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{variance(s.variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PrintSection>

      <div className="mt-5 grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-5">
          <PrintSection title="By cashier">
            <PaperTable
              rows={r.by_cashier.map((c) => [
                `${c.name} · ${c.sales} sale(s)`,
                c.refunds ? `${money(c.total)} (−${money(c.refunds)})` : money(c.total),
              ])}
              empty="No sales."
            />
          </PrintSection>
          <PrintSection title="Promotions used">
            <PaperTable rows={r.promotions.map((p) => [`${p.name} · ${p.lines} line(s)`, `−${money(p.discount)}`])} empty="None." />
          </PrintSection>
        </div>
        <PrintSection title="Top products">
          <PaperTable rows={r.top_products.map((p) => [`${qty(p.qty)} × ${p.name}`, money(p.total)])} empty="No sales." />
        </PrintSection>
      </div>

      <footer className="mt-10 grid grid-cols-2 gap-10 text-[9pt]" style={{ breakInside: "avoid" }}>
        {["Drawer counted by", "Checked by (supervisor)"].map((label) => (
          <div key={label}>
            <div className="h-10 border-b border-black" />
            <p className="mt-1">{label} · name, signature, time</p>
          </div>
        ))}
      </footer>
    </article>
  );
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ breakInside: "avoid" }}>
      <h2 className="mb-1 text-[11pt] font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** Label/amount rows, ruled, with an optional bold total under a heavier rule. */
function PaperTable({ rows, total, empty }: { rows: [string, string][]; total?: [string, string]; empty?: string }) {
  if (!rows.length && !total) return <p>{empty}</p>;
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i} className="align-top">
            <td className="border-b border-neutral-300 py-1 pr-3">{label}</td>
            <td className="border-b border-neutral-300 py-1 text-right whitespace-nowrap tabular-nums">{value}</td>
          </tr>
        ))}
        {total && (
          <tr className="font-bold">
            <td className="border-t-2 border-black py-1.5">{total[0]}</td>
            <td className="border-t-2 border-black py-1.5 text-right whitespace-nowrap tabular-nums">{total[1]}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
