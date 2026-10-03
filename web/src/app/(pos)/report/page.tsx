"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { PageHeader, StatCard, StatusBadge, Totals } from "@/components/pos/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { get } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { dateLabel, money, qty, timeLabel, todayIso } from "@/lib/format";
import { METHOD_LABEL, type DayReport, type Store } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The end-of-day (Z) report: one store, one day, every cashier. Prints on A4 or the receipt printer. */
export default function DayReportPage() {
  const me = useMe();
  const [on, setOn] = useState(todayIso());
  const [storeId, setStoreId] = useState<number | null>(me.shift?.store.id ?? null);
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => get<Store[]>("/api/stores") });
  const store = storeId ?? stores.data?.[0]?.id ?? null;
  const report = useQuery({
    queryKey: ["day-report", store, on],
    queryFn: () => get<DayReport>("/api/reports/day", { store_id: store, on }),
    enabled: store !== null,
  });
  const r = report.data;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 print:gap-3 print:p-0">
      <PageHeader
        title="Day report"
        description="Everything a store took and paid back on one day, across every till and shift."
        actions={
          <>
            <select
              aria-label="Store"
              className="h-9 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30"
              value={store ?? ""}
              onChange={(e) => setStoreId(Number(e.target.value))}
            >
              {stores.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Input type="date" aria-label="Day" className="h-9 w-40" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value || todayIso())} />
            <Button variant="outline" onClick={() => window.print()} disabled={!r}>
              <Printer /> Print
            </Button>
          </>
        }
      />
      {!r ? (
        <Spinner className="mx-auto my-10" />
      ) : (
        <>
          <div className="hidden print:block">
            <h1 className="text-lg font-bold">Day report · {r.store.name}</h1>
            <p className="text-sm">{dateLabel(r.date)} · printed {new Date().toLocaleString("en-GB")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Net takings" value={money(r.net.total)} hint={`incl. PPN ${money(r.net.tax)}`} />
            <StatCard label="Sales" value={r.sales.count} hint={`${qty(r.sales.items)} items · ${money(r.sales.total)}`} />
            <StatCard
              label="Returns and voids"
              value={r.returns.count + r.returns.voids}
              hint={`${r.returns.count} returns · ${r.returns.voids} voids · −${money(r.returns.total)}`}
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
                  rows={[
                    { label: "Sales before discount", value: money(r.sales.gross) },
                    { label: "Discounts", value: `−${money(r.sales.discount)}` },
                    { label: "Sales before tax", value: money(r.sales.subtotal) },
                    { label: "PPN", value: money(r.sales.tax) },
                    { label: "Sales", value: money(r.sales.total) },
                    { label: "Refunds", value: `−${money(r.returns.total)}` },
                    { label: "Net takings", value: money(r.net.total), strong: true },
                  ]}
                />
                {(r.points.earned > 0 || r.points.redeemed > 0 || r.sales.offline > 0) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {r.points.earned > 0 && `${qty(r.points.earned)} loyalty points earned, `}
                    {r.points.redeemed > 0 && `${qty(r.points.redeemed)} spent. `}
                    {r.sales.offline > 0 && `${r.sales.offline} sale(s) rung up offline.`}
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
    </div>
  );
}
