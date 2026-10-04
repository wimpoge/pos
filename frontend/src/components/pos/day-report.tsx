"use client";

import { FileText, Printer, ReceiptText } from "lucide-react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { StatCard, StatusBadge, Totals } from "@/components/pos/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe } from "@/lib/auth";
import { dateLabel, money, qty, timeLabel } from "@/lib/format";
import { METHOD_LABEL, type DayReport } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The end-of-day (Z) report on screen. Used on the Day report page and on the till once it
 * closes; next to it goes <PrintDayReport>, which prints it as a document. */
export function DayReportView({ report }: { report: DayReport | undefined }) {
  return <ScreenReport report={report} />;
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

export type Paper = "a4" | "receipt";
type Section = "shifts" | "cashiers" | "products" | "promotions" | "signatures";
const SECTIONS: [Section, string][] = [
  ["shifts", "Shifts and drawer counts"],
  ["cashiers", "By cashier"],
  ["products", "Top products"],
  ["promotions", "Promotions used"],
  ["signatures", "Lines to sign"],
];
type PaperOptions = { paper: Paper; sections: Record<Section, boolean> };
const OPTIONS_KEY = "pos-day-report-print";
const DEFAULT_OPTIONS: PaperOptions = {
  paper: "a4",
  sections: { shifts: true, cashiers: true, products: true, promotions: true, signatures: true },
};

function loadOptions(): PaperOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as PaperOptions | null;
    if (saved) return { paper: saved.paper, sections: { ...DEFAULT_OPTIONS.sections, ...saved.sections } };
  } catch {}
  return DEFAULT_OPTIONS;
}

/** The Print button: opens a preview of exactly what will print, with the paper (A4 or the 80 mm
 * receipt printer) and the sections to include, remembered on this till. The paper copy is also
 * what Ctrl+P prints. */
export function PrintDayReport({ report }: { report: DayReport | undefined }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PaperOptions>(() => (typeof window === "undefined" ? DEFAULT_OPTIONS : loadOptions()));
  const update = (next: PaperOptions) => {
    setOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {}
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!report}>
        <Printer /> Print
      </Button>
      {report && (
        <PaperPortal>
          <PaperReport report={report} options={options} printOnly />
        </PaperPortal>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <div className="grid max-h-[92svh] min-h-0 md:grid-cols-[17rem_1fr]">
            <div className="flex flex-col gap-5 border-b p-5 md:border-r md:border-b-0">
              <DialogHeader>
                <DialogTitle>Print the day report</DialogTitle>
                <DialogDescription>What you see on the right is what comes out of the printer.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Paper</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["a4", "A4 page", FileText],
                      ["receipt", "Receipt roll", ReceiptText],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={options.paper === value ? "default" : "outline"}
                      className="h-16 flex-col gap-1"
                      onClick={() => update({ ...options, paper: value })}
                    >
                      <Icon /> {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {options.paper === "a4" ? "For the office printer and filing." : "80 mm, on the till's receipt printer."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Include</span>
                <p className="text-xs text-muted-foreground">Totals and payments always print.</p>
                {SECTIONS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={options.sections[key]}
                      onChange={(e) => update({ ...options, sections: { ...options.sections, [key]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-auto flex flex-col gap-2">
                <Button onClick={() => window.print()} disabled={!report}>
                  <Printer /> Print
                </Button>
                <p className="text-xs text-muted-foreground">
                  In the printer window, pick the printer and keep the margins at Default. If the page&apos;s address
                  or the date still shows at the edges, turn off &ldquo;Headers and footers&rdquo; under More settings.
                </p>
              </div>
            </div>
            <div className="min-h-0 overflow-auto bg-muted p-6">
              {report && (
                <div
                  className="mx-auto w-fit shadow-lg ring-1 ring-black/10"
                  style={{ zoom: options.paper === "a4" ? 0.72 : 1 }}
                >
                  <PaperReport report={report} options={options} />
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Paper gets the report alone: it is rendered straight into <body>, outside the app's sidebar and
 * scrolling layout, and globals.css hides everything else when printing. */
function PaperPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="print-root">{children}</div>, document.body);
}

/** The report as a document: black on white and ruled. The page margin is the report's own
 * padding (the @page margin is 0), so the browser has no room to print its URL, title and date. */
function PaperReport({ report: r, options, printOnly = false }: { report: DayReport; options: PaperOptions; printOnly?: boolean }) {
  const me = useMe();
  const receipt = options.paper === "receipt";
  const on = options.sections;
  const variance = (v: number | null) => (v == null ? "—" : v === 0 ? "Exact" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const printed = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  const totals = (
    <PrintSection title="Totals">
      <PaperTable
        rows={[
          ["Sales", `${r.sales.count}${r.sales.voided ? ` (${r.sales.voided} voided)` : ""} · ${qty(r.sales.items)} items`],
          ["Before discount", money(r.sales.gross)],
          ["Discounts", r.sales.discount ? `−${money(r.sales.discount)}` : "—"],
          ["Before tax", money(r.sales.subtotal)],
          ["PPN", money(r.sales.tax)],
          ["Sales total", money(r.sales.total)],
          [`Refunds (${plural(r.returns.count, "return")}, ${plural(r.returns.voids, "void")})`, r.returns.total ? `−${money(r.returns.total)}` : "—"],
        ]}
        total={["Net takings", money(r.net.total)]}
      />
    </PrintSection>
  );
  const notes = (
    <div className="mt-2 text-[0.85em]">
      <p>
        Cash put in {money(r.cash.in)} · taken out {money(r.cash.out)}
        {r.points.earned || r.points.redeemed ? ` · points earned ${qty(r.points.earned)}, spent ${qty(r.points.redeemed)}` : ""}
      </p>
      <p>
        ERP: {r.erp.waiting + r.erp.refused === 0 ? "everything booked" : `${r.erp.waiting} waiting, ${r.erp.refused} refused`}
        {r.sales.offline ? ` · ${r.sales.offline} sale(s) rung up offline` : ""}
      </p>
    </div>
  );
  const payments = (
    <PrintSection title="By payment method">
      {receipt ? (
        <PaperTable
          rows={r.by_method
            .filter((m) => m.taken || m.refunded)
            .map((m) => [`${METHOD_LABEL[m.method]}${m.refunded ? ` (−${money(m.refunded)} back)` : ""}`, money(m.net)])}
          empty="Nothing taken."
        />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Method</Th>
              <Th right>Taken</Th>
              <Th right>Refunded</Th>
              <Th right>Net</Th>
            </tr>
          </thead>
          <tbody>
            {r.by_method.map((m) => (
              <tr key={m.method}>
                <Td>{METHOD_LABEL[m.method]}</Td>
                <Td right>{money(m.taken)}</Td>
                <Td right>{m.refunded ? `−${money(m.refunded)}` : "—"}</Td>
                <Td right bold>
                  {money(m.net)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notes}
    </PrintSection>
  );
  const shifts = on.shifts && (
    <PrintSection title="Shifts">
      {r.shifts.length === 0 ? (
        <p>No shift opened that day.</p>
      ) : receipt ? (
        <PaperTable
          rows={r.shifts.flatMap((s): [string, string][] => [
            [`${s.cashier} · ${timeLabel(s.opened_at)}–${s.closed_at ? timeLabel(s.closed_at) : "open"}`, variance(s.variance)],
            [`  counted ${money(s.counted_cash)} of ${money(s.expected_cash)}`, ""],
          ])}
        />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Shift</Th>
              <Th>Cashier</Th>
              <Th>Hours</Th>
              <Th right>Float</Th>
              <Th right>Expected</Th>
              <Th right>Counted</Th>
              <Th right>Over / short</Th>
            </tr>
          </thead>
          <tbody>
            {r.shifts.map((s) => (
              <tr key={s.id}>
                <Td mono>{s.number}</Td>
                <Td>{s.cashier}</Td>
                <Td>
                  {timeLabel(s.opened_at)}–{s.closed_at ? timeLabel(s.closed_at) : "still open"}
                </Td>
                <Td right>{money(s.opening_float)}</Td>
                <Td right>{money(s.expected_cash)}</Td>
                <Td right>{money(s.counted_cash)}</Td>
                <Td right>{variance(s.variance)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PrintSection>
  );
  const cashiers = on.cashiers && (
    <PrintSection title="By cashier">
      <PaperTable
        rows={r.by_cashier.map((c) => [
          `${c.name} · ${c.sales} sale(s)`,
          c.refunds ? `${money(c.total)} (−${money(c.refunds)})` : money(c.total),
        ])}
        empty="No sales."
      />
    </PrintSection>
  );
  const promotions = on.promotions && (
    <PrintSection title="Promotions used">
      <PaperTable rows={r.promotions.map((p) => [`${p.name} · ${p.lines} line(s)`, `−${money(p.discount)}`])} empty="None." />
    </PrintSection>
  );
  const products = on.products && (
    <PrintSection title="Top products">
      <PaperTable rows={r.top_products.map((p) => [`${qty(p.qty)} × ${p.name}`, money(p.total)])} empty="No sales." />
    </PrintSection>
  );
  const signatures = on.signatures && (
    <footer className={cn("grid text-[0.85em]", receipt ? "mt-6 gap-6" : "mt-8 grid-cols-2 gap-10")} style={{ breakInside: "avoid" }}>
      {["Drawer counted by", "Checked by (supervisor)"].map((label) => (
        <div key={label}>
          <div className="h-10 border-b border-black" />
          <p className="mt-1">{label} · name, signature, time</p>
        </div>
      ))}
    </footer>
  );

  return (
    <article
      className={cn(
        "box-border bg-white font-sans leading-snug text-black",
        receipt ? "w-[80mm] px-[4mm] py-[5mm] text-[8.5pt]" : "min-h-[297mm] w-[210mm] px-[14mm] py-[12mm] text-[10pt]",
        printOnly && "hidden print:block print:min-h-0",
      )}
      // A long day runs onto a second page: repeat the padding there, since the page itself has no margin.
      style={{ boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
    >
      {printOnly && (
        <style>{receipt ? "@page { size: 80mm auto; margin: 0; }" : "@page { size: A4 portrait; margin: 0; }"}</style>
      )}
      <header className={cn("mb-4 border-b-2 border-black pb-2", receipt ? "text-center" : "flex items-end justify-between")}>
        <div>
          <p className="text-[0.85em] tracking-wide uppercase">{me.company.name || "Store"} · Day report</p>
          <h1 className={cn("font-bold", receipt ? "text-[12pt]" : "text-[16pt]")}>{r.store.name}</h1>
        </div>
        <div className={cn("text-[0.85em]", !receipt && "text-right")}>
          <p className={cn("font-semibold", receipt ? "text-[10pt]" : "text-[12pt]")}>{dateLabel(r.date)}</p>
          <p>
            Printed {printed} by {me.full_name}
          </p>
        </div>
      </header>

      {receipt ? (
        <div className="flex flex-col gap-4">
          {totals}
          {payments}
          {shifts}
          {cashiers}
          {products}
          {promotions}
          {signatures}
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-6">
            {totals}
            {payments}
          </div>
          {shifts}
          {(cashiers || promotions || products) && (
            <div className="mt-5 grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-5">
                {cashiers}
                {promotions}
              </div>
              {products}
            </div>
          )}
          {signatures}
        </>
      )}
    </article>
  );
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ breakInside: "avoid" }}>
      <h2 className="mb-1 text-[1.05em] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={cn("border-b border-black py-[3px] text-[0.85em] font-semibold text-black", right ? "text-right" : "text-left")}>{children}</th>;
}

function Td({ children, right, bold, mono }: { children: ReactNode; right?: boolean; bold?: boolean; mono?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-neutral-300 py-[3px] text-black",
        right && "text-right whitespace-nowrap tabular-nums",
        bold && "font-medium",
        mono && "font-mono text-[0.85em]",
      )}
    >
      {children}
    </td>
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
            <td className="border-b border-neutral-300 py-[3px] pr-3 whitespace-pre-wrap text-black">{label}</td>
            <td className="border-b border-neutral-300 py-[3px] text-right whitespace-nowrap text-black tabular-nums">{value}</td>
          </tr>
        ))}
        {total && (
          <tr className="font-bold">
            <td className="border-t-2 border-black py-1 text-black">{total[0]}</td>
            <td className="border-t-2 border-black py-1 text-right whitespace-nowrap text-black tabular-nums">{total[1]}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
