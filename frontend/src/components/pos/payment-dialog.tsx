"use client";

import { Banknote, CreditCard, Gift, Plus, QrCode, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { money } from "@/lib/format";
import { cashSuggestions } from "@/lib/pricing";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PaymentRow = { method: PaymentMethod; amount: number; reference: string };

const ICON = { cash: Banknote, card: CreditCard, qris: QrCode, points: Gift };

/** The customer's loyalty points: how many they can spend, and what one pays for. */
export type PointsWallet = { available: number; value: number };

/** Amount typed with or without thousands dots: "150.000" -> 150000. */
const parseAmount = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const showAmount = (n: number) => (n ? n.toLocaleString("id-ID") : "");

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

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  busy,
  onPay,
  wallet,
  defaultMethod = "cash",
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
}) {
  const [rows, setRows] = useState<PaymentRow[]>([{ method: "cash", amount: 0, reference: "" }]);
  const [split, setSplit] = useState(false);
  const { change, error, cashDue } = settle(total, rows, wallet);
  // Points cover what they can (in whole points); the rest is paid another way.
  const pointsWorth = wallet ? Math.min(wallet.available * wallet.value, Math.floor(total / wallet.value) * wallet.value) : 0;
  const methods = (Object.keys(ICON) as PaymentMethod[]).filter((m) => m !== "points" || pointsWorth > 0);

  // A fresh dialog each time it opens for a new total.
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
    setRows([{ method, amount: method === "cash" ? 0 : total, reference: "" }]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!error) onPay(rows.filter((r) => r.amount > 0));
  }

  const single = rows[0];
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            Total to pay <span className="font-semibold text-foreground tabular-nums">{money(total)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!split ? (
            <>
              <div className={cn("grid gap-2", methods.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
                {methods.map((m) => {
                  const Icon = ICON[m];
                  return (
                    <Button
                      key={m}
                      type="button"
                      variant={single.method === m ? "default" : "outline"}
                      className="h-16 flex-col gap-1"
                      onClick={() => chooseSingle(m)}
                    >
                      <Icon className="size-5" />
                      {METHOD_LABEL[m]}
                      {m === "points" && <span className="text-[10px] font-normal opacity-70">{money(pointsWorth)}</span>}
                    </Button>
                  );
                })}
              </div>
              {single.method === "points" ? (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm">
                  {(total / (wallet?.value || 1)).toLocaleString("id-ID")} points pay the whole total.
                </p>
              ) : single.method === "cash" ? (
                <Field>
                  <FieldLabel htmlFor="tendered">Cash received</FieldLabel>
                  <Input
                    id="tendered"
                    inputMode="numeric"
                    autoFocus
                    className="h-11 text-lg tabular-nums"
                    placeholder={showAmount(total)}
                    value={showAmount(single.amount)}
                    onChange={(e) => set(0, { amount: parseAmount(e.target.value) })}
                  />
                  <div className="flex flex-wrap gap-2">
                    {cashSuggestions(total).map((v) => (
                      <Button key={v} type="button" variant="secondary" size="sm" onClick={() => set(0, { amount: v })}>
                        {v === total ? "Exact" : money(v)}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="ref">
                    {single.method === "card" ? "Approval code" : "QRIS reference"}{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input
                    id="ref"
                    autoFocus
                    value={single.reference}
                    onChange={(e) => set(0, { reference: e.target.value })}
                  />
                </Field>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    aria-label="Method"
                    className="h-9 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30"
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
                    className="h-9 tabular-nums"
                    value={showAmount(r.amount)}
                    onChange={(e) => set(i, { amount: parseAmount(e.target.value) })}
                  />
                  {r.method !== "cash" && r.method !== "points" && (
                    <Input
                      aria-label="Reference"
                      placeholder="Ref."
                      className="h-9 w-24"
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

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
            <span className="text-sm text-muted-foreground">Change</span>
            <span className={cn("text-xl font-semibold tabular-nums", change > 0 && "text-emerald-700 dark:text-emerald-400")}>
              {money(change)}
            </span>
          </div>
          {error && rows.some((r) => r.amount > 0) && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => {
                if (split) chooseSingle("cash");
                else setRows([{ method: "card", amount: 0, reference: "" }, { method: "cash", amount: 0, reference: "" }]);
                setSplit(!split);
              }}
            >
              {split ? "One payment method" : "Split payment"}
            </Button>
            <Button type="submit" size="lg" disabled={busy || !!error}>
              {busy && <Spinner />} Complete sale
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
