"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { useApproval } from "@/components/pos/approval";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { money } from "@/lib/format";
import { lineAmount, taxAmount } from "@/lib/pricing";
import { METHOD_LABEL, type PaymentMethod, type Sale, type SaleReturn } from "@/lib/types";

/** What a return of these quantities refunds, the server's way: the return that takes back the
 * last unit gives back exactly what is left of the sale. */
export function returnTotals(sale: Sale, qty: Record<number, number>) {
  const subtotal = sale.lines.reduce((s, l) => s + lineAmount(qty[l.id] ?? 0, l.unit_price, l.discount_pct), 0);
  const closes = sale.lines.every((l) => l.returned + (qty[l.id] ?? 0) === l.qty);
  if (closes) {
    const sub = sale.subtotal - sale.returns.reduce((s, r) => s + r.subtotal, 0);
    const tax = sale.tax - sale.returns.reduce((s, r) => s + r.tax, 0);
    return { subtotal: sub, tax, total: sub + tax };
  }
  const tax = taxAmount(subtotal, sale.tax_rate);
  return { subtotal, tax, total: subtotal + tax };
}

type Result = { return: SaleReturn; sale: Sale };

export function ReturnDialog({ sale, mode, onClose }: { sale: Sale; mode: "return" | "void" | null; onClose: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const withApproval = useApproval();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [lastMode, setLastMode] = useState<typeof mode>(null);
  if (mode !== lastMode) {
    setLastMode(mode);
    setQty({});
    setReason("");
    setReference("");
    // Refund the way it was paid when it was one way (points go back as points).
    setMethod(sale.payments.length === 1 ? sale.payments[0].method : "cash");
  }

  const totals = returnTotals(sale, qty);
  const named = sale.customer.id !== me.walk_in_customer_id;
  const methods = (Object.keys(METHOD_LABEL) as PaymentMethod[]).filter((m) => m !== "points" || (named && me.loyalty.point_value > 0));
  const pointsOk = method !== "points" || totals.total % me.loyalty.point_value === 0;

  const save = useMutation({
    mutationFn: () =>
      withApproval(
        (approval) =>
          mode === "void"
            ? post<Result>(`/api/sales/${sale.id}/void`, { reason, approval })
            : post<Result>(`/api/sales/${sale.id}/returns`, {
                reason,
                approval,
                lines: Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ sale_line_id: Number(id), qty: q })),
                refunds: [{ method, amount: totals.total, reference: reference || null }],
              }),
        mode === "void" ? `Voiding ${sale.number} (${money(sale.total)}).` : `A refund of ${money(totals.total)} on ${sale.number}.`,
      ),
    onSuccess: (r) => {
      queryClient.setQueryData(["sales", "detail", String(sale.id)], r.sale);
      for (const key of [["sales"], ["sales-summary"], ["shift"], ["catalog"]]) queryClient.invalidateQueries({ queryKey: key });
      const cash = r.return.refunds.find((f) => f.method === "cash");
      toast.success(`${r.return.number} done.${cash ? ` Give back ${money(cash.amount)} cash.` : ""}`);
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const picked = Object.values(qty).some((q) => q > 0);
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "void" ? `Void ${sale.number}` : `Take back from ${sale.number}`}</DialogTitle>
            <DialogDescription>
              {mode === "void"
                ? "The whole sale is cancelled and refunded the way it was paid. The goods go back on the shelf."
                : "The goods go back on the shelf and the money comes out of your drawer (or back to the card, QRIS or points)."}{" "}
              A supervisor approves.
            </DialogDescription>
          </DialogHeader>

          {mode === "return" && (
            <ul className="flex flex-col divide-y rounded-lg border">
              {sale.lines.map((l) => {
                const left = l.qty - l.returned;
                return (
                  <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {l.qty} × {money(l.unit_price)}
                        {l.discount_pct ? ` −${l.discount_pct}%` : ""}
                        {l.returned > 0 && ` · ${l.returned} back already`}
                      </div>
                    </div>
                    <Input
                      aria-label={`Return how many ${l.name}`}
                      inputMode="numeric"
                      disabled={left <= 0}
                      placeholder={left > 0 ? `0–${left}` : "—"}
                      className="h-8 w-20 text-center tabular-nums"
                      value={qty[l.id] || ""}
                      onChange={(e) => setQty({ ...qty, [l.id]: Math.min(Number(e.target.value.replace(/\D/g, "")) || 0, left) })}
                    />
                    <Button type="button" variant="ghost" size="sm" disabled={left <= 0} onClick={() => setQty({ ...qty, [l.id]: left })}>
                      All
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {mode === "return" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ret-method">Refund by</FieldLabel>
                <select
                  id="ret-method"
                  className="h-9 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
                {!pointsOk && <FieldDescription className="text-destructive">Not a whole number of points; refund another way.</FieldDescription>}
              </Field>
              {(method === "card" || method === "qris") && (
                <Field>
                  <FieldLabel htmlFor="ret-ref">Reference <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                  <Input id="ret-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
            </div>
          ) : (
            <ul className="rounded-lg bg-muted px-3 py-2 text-sm">
              {sale.payments.map((p, i) => (
                <li key={i} className="flex justify-between">
                  <span>Back by {METHOD_LABEL[p.method]}</span>
                  <span className="tabular-nums">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          <Field>
            <FieldLabel htmlFor="ret-reason">Reason</FieldLabel>
            <Input id="ret-reason" required maxLength={200} placeholder={mode === "void" ? "e.g. rung up twice" : "e.g. faulty, wrong size"}
              value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
            <span className="text-sm text-muted-foreground">Refund</span>
            <span className="text-xl font-semibold tabular-nums">{money(mode === "void" ? sale.total : totals.total)}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Back
            </Button>
            <Button type="submit" variant={mode === "void" ? "destructive" : "default"}
              disabled={save.isPending || !reason.trim() || (mode === "return" && (!picked || !pointsOk))}>
              {save.isPending && <Spinner />} {mode === "void" ? "Void sale" : "Refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
