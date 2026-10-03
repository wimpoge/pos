"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Clock, LogOut, Monitor, Moon, ReceiptText, ShoppingCart, Sun, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Details, PageHeader, StatCard } from "@/components/pos/common";
import { EndShiftDialog } from "@/components/pos/end-shift-dialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api, get } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { dateTimeLabel, money, relative, timeLabel } from "@/lib/format";
import { METHOD_LABEL, type PaymentMethod, type SalesSummary, type Shift, type ShiftDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const me = useMe();
  const today = useQuery({ queryKey: ["sales-summary"], queryFn: () => get<SalesSummary>("/api/sales/summary") });
  const current = useQuery({ queryKey: ["shift", "current"], queryFn: () => get<ShiftDetail | null>("/api/shifts/current") });
  const recent = useQuery({ queryKey: ["shift", "list"], queryFn: () => get<Shift[]>("/api/shifts", { limit: 10 }) });
  const [ending, setEnding] = useState<number | null>(null);
  const uncounted = recent.data?.filter((s) => s.needs_count) ?? [];
  const initials = me.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const s = today.data;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Profile" description="Your account, your day, and your shift." />

      {uncounted.map((shift) => (
        <Alert key={shift.id}>
          <TriangleAlert />
          <AlertTitle>Count the drawer for {shift.number}</AlertTitle>
          <AlertDescription>
            It ended by itself at closing time ({dateTimeLabel(shift.closed_at)}) before the cash was counted.
          </AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={() => setEnding(shift.id)}>
              Count now
            </Button>
          </AlertAction>
        </Alert>
      ))}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="size-14 rounded-xl">
                <AvatarFallback className="rounded-xl text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <CardTitle className="truncate text-lg">{me.full_name}</CardTitle>
                <CardDescription>
                  <span className="font-mono">{me.username}</span> · Cashier
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Details
                items={[
                  { label: "Logged in", value: me.last_login_at ? relative(me.last_login_at) : "—" },
                  { label: "Discount limit", value: `${me.max_discount_pct}%` },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Your account lives in the ERP{me.company.name ? ` of ${me.company.name}` : ""}. To change your name or
                password, ask an ERP administrator.
              </p>
            </CardContent>
          </Card>
          <Appearance />
          <LogOutButton />
        </div>

        <div className="flex flex-col gap-6">
          <ShiftCard shift={current.data} loading={current.isPending} onEnd={(id) => setEnding(id)} />

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Today</h2>
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
              <StatCard
                label="Takings"
                icon={<Banknote />}
                value={money(s?.net)}
                hint={s && (s.refunds ? `${money(s.total)} sold, ${money(s.refunds)} refunded` : `incl. PPN ${money(s.tax)}`)}
              />
              <StatCard label="Sales" icon={<ReceiptText />} value={s?.sales_count ?? "—"} hint={s && `average ${money(s.average)}`} />
              <StatCard label="Items sold" icon={<ShoppingCart />} value={s?.items ?? "—"} />
              <StatCard
                label="Not in the ERP yet"
                value={s ? s.erp.pending + s.erp.failed : "—"}
                tone={s?.erp.failed ? "danger" : undefined}
                hint={s && (s.erp.pending + s.erp.failed === 0 ? "Every sale is booked" : `${s.erp.failed} refused · ${s.erp.pending} waiting`)}
              />
            </div>
            {s && s.sales_count > 0 && (
              <Card size="sm">
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <div key={m} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{METHOD_LABEL[m]}</span>
                      <span className="tabular-nums">{money(s.by_method[m])}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <EndShiftDialog shiftId={ending} open={ending !== null} onOpenChange={(o) => !o && setEnding(null)} />
    </div>
  );
}

function ShiftCard({ shift, loading, onEnd }: { shift: ShiftDetail | null | undefined; loading: boolean; onEnd: (id: number) => void }) {
  const me = useMe();
  if (loading) return <Spinner />;
  if (!shift)
    return (
      <Card>
        <CardHeader>
          <CardTitle>No shift open</CardTitle>
          <CardDescription>
            {me.after_hours
              ? `Shifts end at ${me.shift_end_time}. The till opens again tomorrow.`
              : "Open a shift at the till to start selling."}
          </CardDescription>
        </CardHeader>
        {!me.after_hours && (
          <CardFooter>
            <Button render={<Link href="/" />} nativeButton={false}>
              Go to the till
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current shift</CardTitle>
        <CardDescription>
          {shift.number} · {shift.store.name}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Details
          items={[
            { label: "Opened", value: dateTimeLabel(shift.opened_at) },
            {
              label: "Ends",
              value: me.shift?.ends_at ? (
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" /> {timeLabel(me.shift.ends_at)}, by itself
                </span>
              ) : (
                "When you end it"
              ),
            },
            { label: "Sales", value: `${shift.summary.sales_count} · ${money(shift.summary.sales_total)}` },
            { label: "Drawer should hold", value: money(shift.summary.expected_cash) },
          ]}
        />
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => onEnd(shift.id)}>End shift</Button>
        <Button variant="outline" render={<Link href="/shift" />} nativeButton={false}>
          Shift details
        </Button>
      </CardFooter>
    </Card>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            variant={(theme ?? "system") === o.value ? "default" : "outline"}
            className={cn("h-14 flex-col gap-1")}
            onClick={() => setTheme(o.value)}
          >
            <o.icon /> {o.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function LogOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      router.replace("/login");
    }
  }
  return (
    <Button variant="outline" onClick={logout} disabled={busy}>
      {busy ? <Spinner /> : <LogOut />} Log out
    </Button>
  );
}
