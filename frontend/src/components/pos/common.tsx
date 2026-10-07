"use client";

import { ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusPills } from "@/components/pos/status-pills";
import { cn } from "@/lib/utils";

/** A page's top: title and one line under it on the left; on the right the status pills (store
 * and shift, closing time, ERP) and the page's own buttons. `shiftPill={false}` when the title
 * already says which shift it is. */
export function PageHeader({
  title,
  description,
  actions,
  badge,
  pills = true,
  shiftPill = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  pills?: boolean;
  shiftPill?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 print:hidden">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl leading-tight font-bold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {(pills || actions) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pills && <StatusPills shift={shiftPill && !actions} />}
          {actions}
        </div>
      )}
    </div>
  );
}

/** A small rounded label next to a page title, e.g. "Ends by itself at 17:00". */
export function TitlePill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold [&_svg]:size-3.5", TONE[tone])}>{children}</span>;
}

// ---------------------------------------------------------------- statuses

type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger" | "muted";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  // a sale on its way to the ERP
  pending: { label: "Waiting for ERP", tone: "warning" },
  synced: { label: "In ERP", tone: "success" },
  failed: { label: "ERP refused", tone: "danger" },
  voided: { label: "Voided", tone: "muted" },
  skipped: { label: "Not needed", tone: "neutral" },
  // shifts and sync runs
  open: { label: "Open", tone: "success" },
  closed: { label: "Closed", tone: "muted" },
  not_counted: { label: "Not counted", tone: "warning" },
  running: { label: "Running", tone: "progress" },
  ok: { label: "OK", tone: "success" },
  partial: { label: "Partly done", tone: "warning" },
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "muted" },
};

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-card text-secondary-foreground",
  info: "border-transparent bg-info-soft text-info",
  progress: "border-transparent bg-warning-soft text-warning",
  success: "border-transparent bg-success-soft text-success",
  warning: "border-transparent bg-warning-soft text-warning",
  danger: "border-transparent bg-danger-soft text-danger",
  muted: "border-transparent bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" as Tone };
  return (
    <Badge variant="outline" className={cn("h-6 rounded-full px-2.5 font-semibold", TONE[s.tone])}>
      {s.label}
    </Badge>
  );
}

export const statusLabel = (status: string) => STATUS[status]?.label ?? status;

// ---------------------------------------------------------------- confirm before acting


export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  variant = "default",
  destructive,
  disabled,
  disabledReason,
  size,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = (
    <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
      {children}
    </Button>
  );
  return (
    <>
      {disabled && disabledReason ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>{button}</TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  // the mutation cache already showed the reason
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />} {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------- layout helpers

/** A figure in a card. `tone` colours the whole card: "ink" for the one that matters most on a
 * page (navy), "warning" / "danger" when something needs attention, "success" when all is well. */
export function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ink" | "warning" | "danger" | "success";
  icon?: ReactNode;
}) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "@container flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3.5",
        tone === "ink" && "border-transparent bg-ink text-ink-foreground",
        tone === "warning" && "border-warning/25 bg-warning-soft text-warning",
        tone === "danger" && "border-danger/25 bg-danger-soft text-danger",
        tone === "success" && "border-success/20 bg-success-soft text-success",
      )}
    >
      <div className={cn("flex items-center justify-between gap-2 text-[13px] font-medium", tone ? "opacity-85" : "text-muted-foreground")}>
        <span className="truncate">{label}</span>
        <span className="[&>svg]:size-4">{icon}</span>
      </div>
      {/* Sized to the card, not the window: four cards in a narrow column still show the whole figure. */}
      <div className="text-xl leading-tight font-bold tracking-tight tabular-nums [overflow-wrap:anywhere] @[13rem]:text-2xl @[16rem]:text-[26px]">{value}</div>
      {hint && <div className={cn("truncate text-xs", tone ? "opacity-80" : "text-muted-foreground")}>{hint}</div>}
    </div>
  );
}

/** Label/value pairs for document headers. */
export function Details({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="min-w-0 space-y-1">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="truncate font-medium">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label/amount rows ending in a total: narrow and right-aligned under a document, `full` to fill a
 * card, `boxed` on a grey panel (in a dialog). */
export function Totals({
  rows,
  full = false,
  boxed = false,
}: {
  rows: { label: string; value: ReactNode; strong?: boolean }[];
  full?: boolean;
  boxed?: boolean;
}) {
  return (
    <dl className={cn("w-full space-y-1.5 text-sm", !full && !boxed && "ml-auto max-w-xs", boxed && "rounded-xl bg-subtle px-4 py-3.5")}>
      {rows.map((r) => (
        <div key={r.label} className={cn("flex justify-between gap-4", r.strong ? "mt-1 border-t border-dashed pt-2.5 text-base font-bold" : "text-muted-foreground")}>
          <dt>{r.label}</dt>
          <dd className="tabular-nums text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
