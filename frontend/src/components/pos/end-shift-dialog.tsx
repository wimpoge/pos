"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Totals } from "@/components/pos/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, get, post } from "@/lib/api";
import { dateTimeLabel, money } from "@/lib/format";
import type { ShiftDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const parseAmount = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const showAmount = (v: string) => (v ? parseAmount(v).toLocaleString("id-ID") : "");

/** End a shift by counting the drawer, or count the drawer of one that ended at closing time. */
export function EndShiftDialog({
  shiftId,
  open,
  onOpenChange,
}: {
  shiftId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const shift = useQuery({
    queryKey: ["shift", "detail", shiftId],
    queryFn: () => get<ShiftDetail>(`/api/shifts/${shiftId}`),
    enabled: open && shiftId !== null,
  });
  const [ended, setEnded] = useState<ShiftDetail | null>(null);

  function change(o: boolean) {
    onOpenChange(o);
    if (!o) setEnded(null);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        {ended ? (
          <Ended shift={ended} onDone={() => change(false)} />
        ) : !shift.data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Loading the shift…
          </div>
        ) : (
          <CountForm key={shift.data.id} shift={shift.data} onEnded={setEnded} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CountForm({ shift, onEnded }: { shift: ShiftDetail; onEnded: (s: ShiftDetail) => void }) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const countingLater = shift.needs_count;
  const expected = countingLater ? (shift.expected_cash ?? 0) : shift.summary.expected_cash;
  const diff = counted === "" ? null : parseAmount(counted) - expected;
  const close = useMutation({
    mutationFn: () =>
      post<ShiftDetail>(`/api/shifts/${shift.id}/close`, { counted_cash: parseAmount(counted), note: note || null }),
    onSuccess: (s) => {
      for (const key of [["shift"], ["me"], ["sales-summary"]]) queryClient.invalidateQueries({ queryKey: key });
      onEnded(s);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    close.mutate();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{countingLater ? "Count the drawer" : "End shift"}</DialogTitle>
        <DialogDescription>
          {countingLater
            ? `${shift.number} ended by itself at closing time (${dateTimeLabel(shift.closed_at)}). Count the cash now.`
            : `${shift.number} at ${shift.store.name}. Count the cash in the drawer to end it.`}
        </DialogDescription>
      </DialogHeader>
      {!countingLater && (
        <Totals boxed
          rows={[
            { label: "Sales", value: `${shift.summary.sales_count} · ${money(shift.summary.sales_total)}` },
            { label: "Opening float", value: money(shift.opening_float) },
            { label: "Cash sales", value: money(shift.summary.by_method.cash) },
            { label: "Cash in − out", value: money(shift.summary.cash_in - shift.summary.cash_out) },
            { label: "Drawer should hold", value: money(expected), strong: true },
          ]}
        />
      )}
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="counted">Counted cash</FieldLabel>
            <InputGroup className="h-14 rounded-xl">
              <InputGroupAddon className="pl-4 text-base font-semibold">Rp</InputGroupAddon>
              <InputGroupInput
                id="counted"
                inputMode="numeric"
                autoFocus
                required
                placeholder="0"
                className="text-2xl font-bold tabular-nums"
                value={showAmount(counted)}
                onChange={(e) => setCounted(e.target.value)}
              />
            </InputGroup>
            <FieldDescription className={cn(diff !== null && diff < 0 && "text-destructive", diff !== null && diff > 0 && "text-amber-700 dark:text-amber-400")}>
              {diff === null
                ? `The drawer should hold ${money(expected)}.`
                : diff === 0
                  ? "Exactly right."
                  : `${money(Math.abs(diff))} ${diff > 0 ? "over" : "short"}. Explain below.`}
            </FieldDescription>
          </Field>
          {diff !== null && diff !== 0 && (
            <Field>
              <FieldLabel htmlFor="note">Note</FieldLabel>
              <Textarea id="note" required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          <Button type="submit" size="lg" className="h-13 rounded-xl text-base font-bold" disabled={close.isPending || counted === ""}>
            {close.isPending && <Spinner />} {countingLater ? "Save count" : "End shift"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}

function Ended({ shift, onDone }: { shift: ShiftDetail; onDone: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      router.replace("/login");
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CircleCheck className="size-5 text-emerald-600" /> Shift {shift.number} ended
        </DialogTitle>
        <DialogDescription>
          {shift.variance === 0
            ? "The drawer was exactly right."
            : `The drawer was ${money(Math.abs(shift.variance ?? 0))} ${(shift.variance ?? 0) > 0 ? "over" : "short"}.`}
        </DialogDescription>
      </DialogHeader>
      <Totals boxed
        rows={[
          { label: "Sales", value: `${shift.summary.sales_count} · ${money(shift.summary.sales_total)}` },
          { label: "Card + QRIS", value: money(shift.summary.by_method.card + shift.summary.by_method.qris) },
          { label: "Expected cash", value: money(shift.expected_cash) },
          { label: "Counted cash", value: money(shift.counted_cash), strong: true },
        ]}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
        <Button onClick={logout} disabled={leaving}>
          {leaving ? <Spinner /> : <LogOut />} Log out
        </Button>
      </DialogFooter>
    </>
  );
}
