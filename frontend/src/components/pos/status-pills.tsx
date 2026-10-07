"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, HardDriveUpload } from "lucide-react";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { money, relative, timeLabel } from "@/lib/format";
import { discardQueued, useOfflineQueue } from "@/lib/offline";
import type { SalesSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const PILL = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold whitespace-nowrap";

/** The pills at the top right of every page: where you sell, when the shift ends, offline sales,
 * and whether the ERP has every sale. `shift={false}` leaves out the store pill. */
export function StatusPills({ shift = true }: { shift?: boolean }) {
  const me = useMe();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {shift && me.shift && (
        <span className={cn(PILL, "hidden lg:inline-flex")}>
          {me.shift.store.name} · {me.shift.number}
        </span>
      )}
      <ShiftClock />
      <OfflinePill />
      <ErpPill />
    </div>
  );
}

/** When the shift ends by itself: amber in its last half hour, and the page refreshes at closing
 * time so the till shows that selling is over (the server already refuses sales then). */
function ShiftClock() {
  const me = useMe();
  const queryClient = useQueryClient();
  const endsAtIso = me.shift?.ends_at ?? null;
  const endsAt = endsAtIso ? Date.parse(endsAtIso.endsWith("Z") ? endsAtIso : `${endsAtIso}Z`) : null;
  const [now, setNow] = useState(() => Date.now());

  // One tick for the countdown and for noticing closing time (within 15 s of it).
  useEffect(() => {
    if (endsAt === null) return;
    let refreshed = false;
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt && !refreshed) {
        refreshed = true;
        for (const key of [["me"], ["shift"], ["catalog"], ["sales-summary"]]) queryClient.invalidateQueries({ queryKey: key });
      }
    }, 15_000);
    return () => clearInterval(tick);
  }, [endsAt, queryClient]);

  if (endsAt === null || !me.shift) return null;
  const minutesLeft = Math.ceil((endsAt - now) / 60_000);
  const soon = minutesLeft <= 30;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn(PILL, "tabular-nums", soon && "border-warning/30 bg-warning-soft text-warning")} />}>
        <Clock className="size-3.5" />
        {soon ? `${Math.max(minutesLeft, 0)} min left` : `Until ${timeLabel(me.shift.ends_at)}`}
      </TooltipTrigger>
      <TooltipContent>Your shift ends by itself at {timeLabel(me.shift.ends_at)}. Count the drawer afterwards.</TooltipContent>
    </Tooltip>
  );
}

/** Sales this till made while the POS server was away, sent by themselves when it is back. */
function OfflinePill() {
  const queryClient = useQueryClient();
  const { items, flush } = useOfflineQueue((n) => {
    toast.success(`${n} offline sale(s) sent.`);
    for (const key of [["sales"], ["sales-summary"], ["shift"], ["catalog"]]) queryClient.invalidateQueries({ queryKey: key });
  });
  if (!items.length) return null;
  const stuck = items.filter((q) => q.error);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(PILL, stuck.length ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning")}
          />
        }
      >
        <HardDriveUpload className="size-3.5" />
        <span className="tabular-nums">{items.length} offline</span>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="text-sm font-semibold">{items.length} sale(s) kept on this till</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Rung up while the POS server was out of reach. They are sent by themselves; don&apos;t clear this browser&apos;s data meanwhile.
        </p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto text-xs">
          {items.map((q) => (
            <li key={q.body.public_id} className="rounded-lg bg-subtle p-2">
              <div className="flex justify-between gap-2">
                <span className="tabular-nums">{money(q.total)}</span>
                <span className="text-muted-foreground">{relative(q.queuedAt)}</span>
              </div>
              {q.error && (
                <div className="mt-1 flex items-start justify-between gap-2 text-danger">
                  <span>{q.error}</span>
                  <Button size="xs" variant="outline" onClick={() => discardQueued(q.body.public_id)}>
                    Discard
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-2 w-full" onClick={() => flush()}>
          Send now
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Sales waiting for the ERP, and a quiet retry every minute while there are any. */
function ErpPill() {
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: ["sales-summary"],
    queryFn: () => get<SalesSummary>("/api/sales/summary"),
    refetchInterval: 30_000,
  });
  const pending = summary.data?.erp.pending ?? 0;
  const failed = summary.data?.erp.failed ?? 0;
  const retry = useMutation({
    mutationFn: () => post("/api/sales/push-pending"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: () => {}, // background retry: the pill shows the outcome
  });
  const lastTry = useRef(0);
  useEffect(() => {
    if (pending > 0 && !retry.isPending && Date.now() - lastTry.current > 60_000) {
      lastTry.current = Date.now();
      retry.mutate();
    }
  }, [pending, summary.dataUpdatedAt, retry]);

  const [tone, text, label]: [string, ReactNode, string] = failed
    ? ["border-danger/25 bg-danger-soft text-danger", `${failed} refused`, `${failed} sale(s) refused by the ERP. Open Sales to see why; they are retried every 10 minutes.`]
    : pending
      ? ["border-warning/30 bg-warning-soft text-warning", `${pending} waiting`, `${pending} sale(s) waiting to reach the ERP. Retrying.`]
      : ["border-success/20 bg-success-soft text-success", "ERP synced", "Every sale is in the ERP."];
  return (
    <Tooltip>
      <TooltipTrigger render={<Link href="/sales" className={cn(PILL, tone)} />}>
        <span className="size-1.5 rounded-full bg-current" />
        {text}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
