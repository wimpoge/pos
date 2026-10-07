"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Lock } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { PageHeader, StatCard, StatusBadge, TitlePill, Totals } from "@/components/pos/common";
import { EndShiftDialog } from "@/components/pos/end-shift-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { get, post } from "@/lib/api";
import { useApproval } from "@/components/pos/approval";
import { useMe } from "@/lib/auth";
import { dateTimeLabel, money, timeLabel } from "@/lib/format";
import type { Shift, ShiftDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const parseAmount = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const showAmount = (v: string) => (v ? parseAmount(v).toLocaleString("id-ID") : "");

export default function ShiftPage() {
  const current = useQuery({ queryKey: ["shift", "current"], queryFn: () => get<ShiftDetail | null>("/api/shifts/current") });
  const history = useQuery({ queryKey: ["shift", "list"], queryFn: () => get<Shift[]>("/api/shifts", { limit: 30 }) });
  const me = useMe();
  const [dialog, setDialog] = useState<"in" | "out" | null>(null);
  const [ending, setEnding] = useState<number | null>(null);
  const shift = current.data;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Shift"
        description={shift ? `${shift.number} · ${shift.store.name} · opened ${dateTimeLabel(shift.opened_at)}` : "No shift open."}
        shiftPill={false}
        badge={
          shift ? (
            <>
              <TitlePill tone="success">Open</TitlePill>
              {me.shift?.ends_at && (
                <TitlePill>
                  <Clock /> Ends by itself at {timeLabel(me.shift.ends_at)}
                </TitlePill>
              )}
            </>
          ) : undefined
        }
        actions={
          shift && (
            <>
              <Button variant="outline" onClick={() => setDialog("in")}>
                <ArrowDownToLine /> Cash in
              </Button>
              <Button variant="outline" onClick={() => setDialog("out")}>
                <ArrowUpFromLine /> Cash out
              </Button>
              <Button onClick={() => setEnding(shift.id)}>
                <Lock /> End shift
              </Button>
            </>
          )
        }
      />

      {current.isPending ? (
        <Spinner />
      ) : shift ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Sales"
              value={shift.summary.sales_count}
              hint={`${money(shift.summary.sales_total)}${shift.summary.refunds_count ? ` · ${shift.summary.refunds_count} refund(s) −${money(shift.summary.refunds_total)}` : ""}`}
            />
            <StatCard label="Cash sales" value={money(shift.summary.by_method.cash)} hint={shift.summary.refunds_count ? "less cash refunds" : undefined} />
            <StatCard label="Card + QRIS" value={money(shift.summary.by_method.card + shift.summary.by_method.qris)} hint={`${money(shift.summary.by_method.card)} card · ${money(shift.summary.by_method.qris)} QRIS`} />
            <StatCard label="Drawer should hold" tone="ink" value={money(shift.summary.expected_cash)} hint="float + cash sales ± movements" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cash drawer</CardTitle>
              </CardHeader>
              <CardContent>
                <Totals
                  full
                  rows={[
                    { label: "Opening float", value: money(shift.opening_float) },
                    { label: "Cash sales, less refunds", value: money(shift.summary.by_method.cash) },
                    { label: "Cash in", value: money(shift.summary.cash_in) },
                    { label: "Cash out", value: `−${money(shift.summary.cash_out)}` },
                    { label: "Expected in drawer", value: money(shift.summary.expected_cash), strong: true },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cash movements</CardTitle>
              </CardHeader>
              <CardContent>
                {shift.movements.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-subtle px-4 py-8 text-center">
                    <p className="font-semibold">No movements yet</p>
                    <p className="text-sm text-muted-foreground">Cash put in or taken out this shift shows here.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {shift.movements.map((m) => (
                      <li key={m.id} className="flex justify-between gap-4">
                        <span className="min-w-0">
                          <span className="block truncate">{m.reason}</span>
                          <span className="text-xs text-muted-foreground">
                            {dateTimeLabel(m.at)} · {m.user}
                            {m.approved_by && ` · approved by ${m.approved_by}`}
                          </span>
                        </span>
                        <span className={cn("tabular-nums", m.kind === "out" && "text-destructive")}>
                          {m.kind === "out" ? "−" : "+"}
                          {money(m.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Open a shift at the till to start selling.</p>
            <Button render={<Link href="/" />} nativeButton={false}>
              Go to the till
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <Card className="gap-0 pb-0">
          <h2 className="px-5 pb-3 text-[17px] font-bold">Your recent shifts</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead>
                <TableHead className="hidden md:table-cell">Store</TableHead>
                <TableHead className="hidden sm:table-cell">Opened</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Over / short</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.number}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.store.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{dateTimeLabel(s.opened_at)}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.needs_count ? "not_counted" : s.status} />
                    {s.auto_closed && <span className="ml-1.5 hidden text-xs text-muted-foreground lg:inline">at closing time</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.needs_count ? (
                      <Button size="xs" variant="outline" onClick={() => setEnding(s.id)}>
                        Count
                      </Button>
                    ) : s.counted_cash == null ? (
                      "—"
                    ) : (
                      money(s.counted_cash)
                    )}
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", s.variance && s.variance < 0 && "text-destructive", s.variance && s.variance > 0 && "text-amber-700 dark:text-amber-400")}
                    title={s.closing_note ?? undefined}
                  >
                    {s.variance == null ? "—" : s.variance === 0 ? "Exact" : `${s.variance > 0 ? "+" : "−"}${money(Math.abs(s.variance))}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {shift && <CashDialog shift={shift} kind={dialog === "in" || dialog === "out" ? dialog : null} onClose={() => setDialog(null)} />}
      <EndShiftDialog shiftId={ending} open={ending !== null} onOpenChange={(o) => !o && setEnding(null)} />
    </div>
  );
}

function CashDialog({ shift, kind, onClose }: { shift: ShiftDetail; kind: "in" | "out" | null; onClose: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const withApproval = useApproval();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    // A large cash-out asks for a supervisor first (the server would ask anyway).
    mutationFn: () =>
      withApproval(
        (approval) => post(`/api/shifts/${shift.id}/cash`, { kind, amount: parseAmount(amount), reason, approval }),
        kind === "out" && parseAmount(amount) > me.cash_out_approval_above
          ? `Taking out more than ${money(me.cash_out_approval_above)}.`
          : undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift"] });
      setAmount("");
      setReason("");
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "in" ? "Put cash in the drawer" : "Take cash out of the drawer"}</DialogTitle>
          <DialogDescription>
            {kind === "in" ? "For example extra change from the safe." : "For example a small purchase or a bank deposit."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cash-amount">Amount (Rp)</FieldLabel>
              <Input id="cash-amount" inputMode="numeric" autoFocus required value={showAmount(amount)} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cash-reason">Reason</FieldLabel>
              <Input id="cash-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button type="submit" disabled={save.isPending || !parseAmount(amount)}>
              {save.isPending && <Spinner />} Save
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
