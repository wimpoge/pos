"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, CloudCheck, CloudOff, HardDriveUpload, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppSidebar, findNav } from "@/components/pos/app-sidebar";
import { ApprovalProvider } from "@/components/pos/approval";
import { LockProvider } from "@/components/pos/lock";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { get, post } from "@/lib/api";
import { AuthProvider, useMe } from "@/lib/auth";
import { money, relative, timeLabel } from "@/lib/format";
import { discardQueued, useOfflineQueue } from "@/lib/offline";
import type { SalesSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider
      fallback={
        <div className="flex h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      }
    >
      <ApprovalProvider>
        <LockProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="h-svh min-w-0 overflow-hidden print:h-auto print:overflow-visible">
              <Header />
              <main className="flex min-h-0 flex-1 flex-col overflow-y-auto print:overflow-visible">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </LockProvider>
      </ApprovalProvider>
    </AuthProvider>
  );
}

function Header() {
  const me = useMe();
  const nav = findNav(usePathname());
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur print:hidden">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
      {nav && <p className="text-sm">{nav.title}</p>}
      <div className="ml-auto flex items-center gap-3">
        {me.shift && (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {me.shift.store.name} · {me.shift.number}
          </Badge>
        )}
        <ShiftClock />
        <OfflineIndicator />
        <ErpIndicator />
      </div>
    </header>
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
      <TooltipTrigger
        render={
          <span
            className={cn(
              "flex items-center gap-1 text-sm tabular-nums",
              soon ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
          />
        }
      >
        <Clock className="size-4" />
        {soon ? `${Math.max(minutesLeft, 0)} min left` : <span className="hidden sm:inline">until {timeLabel(me.shift.ends_at)}</span>}
      </TooltipTrigger>
      <TooltipContent>Your shift ends by itself at {timeLabel(me.shift.ends_at)}. Count the drawer afterwards.</TooltipContent>
    </Tooltip>
  );
}

/** Sales this till made while the POS server was away, sent by themselves when it is back. */
function OfflineIndicator() {
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
        render={<button type="button" className={cn("flex items-center gap-1 text-sm", stuck.length ? "text-destructive" : "text-amber-600 dark:text-amber-400")} />}
      >
        <HardDriveUpload className="size-4" />
        <span className="tabular-nums">{items.length}</span>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="text-sm font-medium">{items.length} sale(s) kept on this till</p>
        <p className="mb-2 text-xs text-muted-foreground">Rung up while the POS server was out of reach. They are sent by themselves; don&apos;t clear this browser&apos;s data meanwhile.</p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto text-xs">
          {items.map((q) => (
            <li key={q.body.public_id} className="rounded-md bg-muted/50 p-2">
              <div className="flex justify-between gap-2">
                <span className="tabular-nums">{money(q.total)}</span>
                <span className="text-muted-foreground">{relative(q.queuedAt)}</span>
              </div>
              {q.error && (
                <div className="mt-1 flex items-start justify-between gap-2 text-destructive">
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
function ErpIndicator() {
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
    onError: () => {}, // background retry: the indicator shows the outcome
  });
  const lastTry = useRef(0);
  useEffect(() => {
    if (pending > 0 && !retry.isPending && Date.now() - lastTry.current > 60_000) {
      lastTry.current = Date.now();
      retry.mutate();
    }
  }, [pending, summary.dataUpdatedAt, retry]);

  const [Icon, tone, label] = failed
    ? [TriangleAlert, "text-destructive", `${failed} sale(s) refused by the ERP. Open Sales to see why; they are retried every 10 minutes.`]
    : pending
      ? [CloudOff, "text-amber-600 dark:text-amber-400", `${pending} sale(s) waiting to reach the ERP. Retrying.`]
      : [CloudCheck, "text-emerald-600 dark:text-emerald-400", "Every sale is in the ERP."];
  return (
    <Tooltip>
      <TooltipTrigger render={<Link href="/sales" className={cn("flex items-center gap-1 text-sm", tone)} />}>
        <Icon className="size-4" />
        {failed + pending > 0 && <span className="tabular-nums">{failed + pending}</span>}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
