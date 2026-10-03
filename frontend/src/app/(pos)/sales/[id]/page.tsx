"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CloudUpload, Printer, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Details, PageHeader, StatusBadge } from "@/components/pos/common";
import { Receipt } from "@/components/pos/receipt";
import { EmailReceiptButton, printReceipt } from "@/components/pos/receipt-dialog";
import { ReturnDialog } from "@/components/pos/return-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { dateTimeLabel, money } from "@/lib/format";
import { METHOD_LABEL, type Sale } from "@/lib/types";

export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const queryClient = useQueryClient();
  const sale = useQuery({ queryKey: ["sales", "detail", id], queryFn: () => get<Sale>(`/api/sales/${id}`) });
  // From the Returns page: /sales/12?return=1 opens the return straight away.
  const [taking, setTaking] = useState<"return" | "void" | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("return") ? "return" : null,
  );
  const push = useMutation({
    mutationFn: () => post<Sale>(`/api/sales/${id}/push`),
    onSuccess: (s) => {
      queryClient.setQueryData(["sales", "detail", id], s);
      queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
      if (s.erp.status === "synced") toast.success(`Booked in the ERP as ${s.erp.order_number}.`);
      else toast.error(s.erp.error ?? "The ERP did not take it.");
    },
  });

  if (!sale.data)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        {sale.isError ? "Sale not found." : <><Spinner /> Loading…</>}
      </div>
    );

  const s = sale.data;
  const returnable = !s.voided && s.lines.some((l) => l.returned < l.qty);
  const voidable = !s.voided && s.returns.length === 0 && me.shift?.id === s.shift.id;
  const unsentReturns = s.returns.filter((r) => r.erp.status === "pending" || r.erp.status === "failed");
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={<span className="font-mono">{s.number}</span>}
        badge={
          <>
            <StatusBadge status={s.erp.status} />
            {s.refunded > 0 && !s.voided && <Badge variant="outline">{money(s.refunded)} refunded</Badge>}
            {s.offline && <Badge variant="outline">Rung up offline</Badge>}
          </>
        }
        description={`${s.store.name} · ${dateTimeLabel(s.created_at)} · ${s.cashier.full_name}`}
        actions={
          <>
            <Button variant="ghost" render={<Link href="/sales" />} nativeButton={false}>
              <ArrowLeft /> Sales
            </Button>
            <EmailReceiptButton sale={s} />
            <Button variant="outline" onClick={() => printReceipt(s.id, true)}>
              <Printer /> Reprint
            </Button>
            {me.shift && returnable && (
              <Button variant="outline" onClick={() => setTaking("return")}>
                <Undo2 /> Return
              </Button>
            )}
            {voidable && (
              <Button variant="destructive" onClick={() => setTaking("void")}>
                <Ban /> Void
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="self-start rounded-xl border bg-white">
          <Receipt sale={s} company={me.company} />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>In the ERP</CardTitle>
              <CardDescription>
                {s.erp.status === "voided"
                  ? "Voided before it reached the ERP, so it was never sent."
                  : `Sent as a paid sales order: shipped from ${s.store.name}, invoiced and settled in one go.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {s.erp.status === "failed" && (
                <Alert variant="destructive">
                  <AlertTitle>The ERP refused this sale</AlertTitle>
                  <AlertDescription>
                    {s.erp.error} Once it is fixed in the ERP (for example the stock booked in), the POS sends
                    it again by itself within 10 minutes, or press the button below.
                  </AlertDescription>
                </Alert>
              )}
              {s.erp.status === "pending" && (
                <Alert>
                  <AlertTitle>Waiting to reach the ERP</AlertTitle>
                  <AlertDescription>{s.erp.error ?? "It will be sent shortly."} The till retries automatically.</AlertDescription>
                </Alert>
              )}
              <Details
                items={[
                  { label: "Sales order", value: <span className="font-mono">{s.erp.order_number ?? "—"}</span> },
                  { label: "Invoice", value: <span className="font-mono">{s.erp.invoice_number ?? "—"}</span> },
                  { label: "Booked", value: dateTimeLabel(s.erp.synced_at) },
                  { label: "Attempts", value: s.erp.attempts },
                  { label: "Last attempt", value: dateTimeLabel(s.erp.last_attempt_at) },
                  { label: "Shift", value: s.shift.number },
                  ...(s.approved_by ? [{ label: "Discount approved by", value: s.approved_by }] : []),
                  ...(s.voucher_code ? [{ label: "Voucher", value: <span className="font-mono">{s.voucher_code}</span> }] : []),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                External id <span className="font-mono">{s.external_id}</span>. The ERP keeps one order per id, so
                sending again can never book the sale twice.
              </p>
              {(s.erp.status === "pending" || s.erp.status === "failed" || unsentReturns.length > 0) && (
                <Button className="self-start" onClick={() => push.mutate()} disabled={push.isPending}>
                  {push.isPending ? <Spinner /> : <CloudUpload />} Send to the ERP now
                </Button>
              )}
            </CardContent>
          </Card>

          {s.returns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Returns</CardTitle>
                <CardDescription>Goods that came back and the money handed back.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y text-sm">
                  {s.returns.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{r.number}</span>
                          {r.kind === "void" && <Badge variant="destructive">Void</Badge>}
                          <StatusBadge status={r.erp.status} />
                        </div>
                        <p>{r.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {dateTimeLabel(r.created_at)} · {r.cashier} · approved by {r.approved_by} · {r.reason}
                        </p>
                        {r.erp.error && r.erp.status !== "synced" && <p className="text-xs text-destructive">{r.erp.error}</p>}
                        {r.erp.return_number && <p className="font-mono text-xs text-muted-foreground">ERP {r.erp.return_number}</p>}
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">−{money(r.total)}</div>
                        <div className="text-xs text-muted-foreground">{r.refunds.map((f) => METHOD_LABEL[f.method]).join(" + ")}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <ReturnDialog sale={s} mode={taking} onClose={() => setTaking(null)} />
    </div>
  );
}
