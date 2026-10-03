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
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
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
  open: { label: "Open", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
  not_counted: { label: "Not counted", tone: "warning" },
  running: { label: "Running", tone: "progress" },
  ok: { label: "OK", tone: "success" },
  partial: { label: "Partly done", tone: "warning" },
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "muted" },
};

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-transparent text-muted-foreground",
  info: "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300",
  progress: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  success: "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warning: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  danger: "border-transparent bg-destructive/10 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground line-through decoration-1",
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" as Tone };
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[s.tone])}>
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
  tone?: "danger" | "success";
  icon?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {label}
          <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
        </CardDescription>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      </CardHeader>
      {hint && (
        <CardContent
          className={cn(
            "text-xs text-muted-foreground",
            tone === "danger" && "text-destructive",
            tone === "success" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {hint}
        </CardContent>
      )}
    </Card>
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

export function Totals({ rows }: { rows: { label: string; value: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.label} className={cn("flex justify-between gap-4", r.strong ? "border-t pt-2 text-base font-semibold" : "text-muted-foreground")}>
          <dt>{r.label}</dt>
          <dd className="tabular-nums text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
