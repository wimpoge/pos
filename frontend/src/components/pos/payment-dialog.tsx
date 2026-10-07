"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, Delete, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { money, qty as fmtQty } from "@/lib/format";
import { cashSuggestions, type CartTotals } from "@/lib/pricing";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PaymentRow = { method: PaymentMethod; amount: number; reference: string };

const METHODS: PaymentMethod[] = ["cash", "card", "qris", "points"];

/** The customer's loyalty points: how many they can spend, and what one pays for. */
export type PointsWallet = { available: number; value: number };

/** Amount typed with or without thousands dots: "150.000" -> 150000. */
const parseAmount = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const showAmount = (n: number) => (n ? n.toLocaleString("id-ID") : "");
const MAX_AMOUNT = 999_999_999_999;

/** Card, QRIS and points take exact amounts; cash covers the rest and may be more (change). */
export function settle(total: number, rows: PaymentRow[], wallet?: PointsWallet | null) {
  const nonCash = rows.filter((r) => r.method !== "cash").reduce((s, r) => s + r.amount, 0);
  const tendered = rows.filter((r) => r.method === "cash").reduce((s, r) => s + r.amount, 0);
  const byPoints = rows.filter((r) => r.method === "points").reduce((s, r) => s + r.amount, 0);
  const cashDue = Math.max(total - nonCash, 0);
  const error =
    byPoints && !wallet
      ? "Pick the customer to pay with their points."
      : byPoints && wallet && byPoints % wallet.value
        ? `Points pay in steps of ${money(wallet.value)}.`
        : byPoints && wallet && byPoints / wallet.value > wallet.available
          ? `Only ${wallet.available.toLocaleString("id-ID")} points (${money(wallet.available * wallet.value)}) to spend.`
          : nonCash > total
            ? "Card, QRIS and points add up to more than the total."
            : tendered < cashDue
              ? `${money(cashDue - tendered)} still to pay.`
              : cashDue === 0 && tendered > 0
                ? "Card, QRIS and points already cover the total; remove the cash."
                : null;
  return { nonCash, tendered, cashDue, change: Math.max(tendered - cashDue, 0), error };
}

/** The pay screen: what is being bought on the left, how it is paid on the right. It covers the
 * whole window, like a card terminal, and Esc goes back to the till. */
export function PaymentDialog({
  open,
  onOpenChange,
  total,
  busy,
  onPay,
  wallet,
  defaultMethod = "cash",
  totals,
  customerName,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  busy: boolean;
  onPay: (rows: PaymentRow[]) => void;
  /** The customer's points, when they have any to spend (and the server can be reached). */
  wallet?: PointsWallet | null;
  /** The cashier's preferred method; card and QRIS start with the exact total. */
  defaultMethod?: "cash" | "card" | "qris";
  /** The priced cart, for the summary. */
  totals: CartTotals;
  customerName: string;
  /** Store and shift, under the title. */
  context: string;
}) {
  const [rows, setRows] = useState<PaymentRow[]>([{ method: "cash", amount: 0, reference: "" }]);
  const [split, setSplit] = useState(false);
  const { change, error, cashDue } = settle(total, rows, wallet);
  // Points cover what they can (in whole points); the rest is paid another way.
  const pointsWorth = wallet ? Math.min(wallet.available * wallet.value, Math.floor(total / wallet.value) * wallet.value) : 0;
  const methods = METHODS.filter((m) => m !== "points" || pointsWorth > 0);

  // A fresh screen each time it opens for a new total.
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (open && openedFor !== total) {
    setOpenedFor(total);
    setRows([{ method: defaultMethod, amount: defaultMethod === "cash" ? 0 : total, reference: "" }]);
    setSplit(false);
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const set = (i: number, patch: Partial<PaymentRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function chooseSingle(method: PaymentMethod) {
    if (method === "points" && pointsWorth < total) {
      // Not enough to cover it all: spend the points, pay the rest in cash.
      setSplit(true);
      setRows([{ method: "points", amount: pointsWorth, reference: "" }, { method: "cash", amount: total - pointsWorth, reference: "" }]);
      return;
    }
    setSplit(false);
    setRows([{ method, amount: method === "cash" ? 0 : total, reference: "" }]);
  }

  /** The keypad: digits append, 000 multiplies, ⌫ takes the last digit off. */
  function key(k: string) {
    const now = rows[0].amount;
    const next = k === "back" ? Math.floor(now / 10) : k === "000" ? now * 1000 : now * 10 + Number(k);
    set(0, { amount: Math.min(next, MAX_AMOUNT) });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!error && !busy) onPay(rows.filter((r) => r.amount > 0));
  }

  const single = rows[0];
  const cashSingle = !split && single.method === "cash";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-slot="pay-screen"
          className="fixed inset-0 z-50 flex flex-col bg-background text-sm outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            {/* ---------------------------------------------------------------- top bar */}
            <header className="flex shrink-0 items-center gap-4 border-b bg-card px-4 py-3 md:px-6">
              <DialogPrimitive.Close
                render={<Button type="button" variant="outline" size="icon-lg" aria-label="Back to the till" disabled={busy} />}
              >
                <ChevronLeft />
              </DialogPrimitive.Close>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-2xl leading-tight font-bold tracking-tight">Pay</DialogPrimitive.Title>
                <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">{context}</DialogPrimitive.Description>
              </div>
              <p className="ml-auto hidden truncate text-sm text-muted-foreground sm:block">
                Customer: <span className="font-semibold text-foreground">{customerName}</span>
              </p>
            </header>

            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(17rem,24rem)_1fr] md:gap-5 md:p-6">
              {/* ---------------------------------------------------------------- summary */}
              <section className="flex min-h-0 flex-col rounded-2xl border bg-card p-5">
                <h2 className="text-[17px] font-bold">Summary</h2>
                <ul className="mt-3 min-h-0 flex-1 divide-y overflow-y-auto">
                  {totals.lines.map((l) => (
                    <li key={l.key} className="flex justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        {fmtQty(l.qty)}× {l.name}
                        {l.free ? (
                          <span className="ml-1 text-xs font-semibold text-success">free</span>
                        ) : (
                          l.discount > 0 && <span className="ml-1 text-xs font-semibold text-success">−{l.discount}%</span>
                        )}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(l.total)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 space-y-1.5 border-t pt-4 text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>Before discount</dt>
                    <dd className="tabular-nums">{money(totals.gross)}</dd>
                  </div>
                  {totals.discount > 0 && (
                    <div className="flex justify-between">
                      <dt>Discount</dt>
                      <dd className="tabular-nums">−{money(totals.discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt>PPN</dt>
                    <dd className="tabular-nums">{money(totals.tax)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-dashed pt-3 text-foreground">
                    <dt className="font-semibold">To pay</dt>
                    <dd className="text-[28px] leading-none font-extrabold tracking-tight tabular-nums">{money(total)}</dd>
                  </div>
                </dl>
              </section>

              {/* ---------------------------------------------------------------- payment */}
              <section className="flex min-h-0 flex-col gap-4 rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[17px] font-bold">Payment method</h2>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0"
                    onClick={() => {
                      if (split) chooseSingle("cash");
                      else {
                        setSplit(true);
                        setRows([{ method: "card", amount: 0, reference: "" }, { method: "cash", amount: 0, reference: "" }]);
                      }
                    }}
                  >
                    {split ? "One payment method" : "Split payment"}
                  </Button>
                </div>

                {!split && (
                  <div className={cn("grid gap-3", methods.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
                    {methods.map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={single.method === m}
                        onClick={() => chooseSingle(m)}
                        className={cn(
                          "flex h-14 flex-col items-center justify-center rounded-xl border bg-card font-semibold transition-colors hover:bg-subtle",
                          single.method === m && "border-2 border-primary bg-accent text-accent-foreground hover:bg-accent",
                        )}
                      >
                        {METHOD_LABEL[m]}
                        {m === "points" && <span className="text-[11px] font-medium opacity-70">{money(pointsWorth)}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {cashSingle ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_minmax(15rem,19rem)]">
                    <div className="flex flex-col gap-4">
                      <label className="block rounded-xl border bg-subtle px-4 py-3">
                        <span className="text-xs font-medium text-muted-foreground">Cash received</span>
                        <span className="flex items-baseline gap-2">
                          <span className="text-3xl font-extrabold tracking-tight text-muted-foreground">Rp</span>
                          <input
                            inputMode="numeric"
                            autoFocus
                            aria-label="Cash received"
                            className="w-full min-w-0 bg-transparent text-[34px] leading-tight font-extrabold tracking-tight tabular-nums outline-none placeholder:text-muted-foreground/40"
                            placeholder={showAmount(total)}
                            value={showAmount(single.amount)}
                            onChange={(e) => set(0, { amount: Math.min(parseAmount(e.target.value), MAX_AMOUNT) })}
                          />
                        </span>
                      </label>
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Quick amounts</p>
                        <div className="grid grid-cols-2 gap-2">
                          {cashSuggestions(total)
                            .slice(0, 4)
                            .map((v) => (
                              <Button key={v} type="button" variant="outline" className="h-12 text-[15px]" onClick={() => set(0, { amount: v })}>
                                {v === total ? "Exact" : money(v)}
                              </Button>
                            ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "back"].map((k) => (
                        <Button
                          key={k}
                          type="button"
                          variant="outline"
                          className="h-14 text-xl font-bold lg:h-16"
                          aria-label={k === "back" ? "Delete a digit" : k}
                          onClick={() => key(k)}
                        >
                          {k === "back" ? <Delete className="size-5" /> : k}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : !split && single.method === "points" ? (
                  <p className="rounded-xl bg-subtle px-4 py-3 text-sm">
                    {(total / (wallet?.value || 1)).toLocaleString("id-ID")} points pay the whole total.
                  </p>
                ) : !split ? (
                  <div className="flex flex-col gap-3">
                    <p className="rounded-xl bg-subtle px-4 py-3">
                      Charge <span className="font-bold tabular-nums">{money(total)}</span> on the {single.method === "card" ? "card machine" : "QRIS code"}.
                    </p>
                    <Field>
                      <FieldLabel htmlFor="ref">
                        {single.method === "card" ? "Approval code" : "QRIS reference"}{" "}
                        <span className="font-normal text-muted-foreground">(optional)</span>
                      </FieldLabel>
                      <Input id="ref" autoFocus className="h-12" value={single.reference} onChange={(e) => set(0, { reference: e.target.value })} />
                    </Field>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {rows.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          aria-label="Method"
                          className="h-11 rounded-lg border border-input bg-card px-3 text-sm"
                          value={r.method}
                          onChange={(e) => set(i, { method: e.target.value as PaymentMethod })}
                        >
                          {methods.map((m) => (
                            <option key={m} value={m}>
                              {METHOD_LABEL[m]}
                            </option>
                          ))}
                        </select>
                        <Input
                          aria-label="Amount"
                          inputMode="numeric"
                          className="h-11 tabular-nums"
                          value={showAmount(r.amount)}
                          onChange={(e) => set(i, { amount: Math.min(parseAmount(e.target.value), MAX_AMOUNT) })}
                        />
                        {r.method !== "cash" && r.method !== "points" && (
                          <Input
                            aria-label="Reference"
                            placeholder="Ref."
                            className="h-11 w-28"
                            value={r.reference}
                            onChange={(e) => set(i, { reference: e.target.value })}
                          />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove payment"
                          disabled={rows.length === 1}
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => setRows([...rows, { method: "cash", amount: cashDue, reference: "" }])}
                    >
                      <Plus /> Add payment
                    </Button>
                  </div>
                )}

                <div className="mt-auto flex flex-col gap-3 pt-2">
                  {error && rows.some((r) => r.amount > 0) && <p className="text-sm font-medium text-danger">{error}</p>}
                  <div
                    className={cn(
                      "flex items-center justify-between rounded-xl px-4 py-3",
                      change > 0 ? "bg-success-soft text-success" : "bg-subtle text-muted-foreground",
                    )}
                  >
                    <span className="font-semibold">Change</span>
                    <span className="text-2xl font-extrabold tracking-tight tabular-nums">{money(change)}</span>
                  </div>
                  <Button type="submit" size="lg" className="h-14 rounded-xl text-base font-bold" disabled={busy || !!error}>
                    {busy && <Spinner />} Complete sale
                  </Button>
                </div>
              </section>
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
