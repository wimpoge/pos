"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, KeyRound, Laptop, LogOut, Monitor, Moon, Smartphone, Sun, Table2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageHeader, StatCard } from "@/components/pos/common";
import { useLock } from "@/components/pos/lock";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, del, get, post, put } from "@/lib/api";
import { forgetMe, useMe, type Preferences } from "@/lib/auth";
import { dateLabel, money, moneyShort, qty, relative } from "@/lib/format";
import type { CashierStats, DeviceSession, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The cashier's own page: who they are, how their selling went, how they like the till, and the
 * safety of their account. The shift itself lives on the Shift page. */
export default function ProfilePage() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => get<Profile>("/api/me/profile") });

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Profile" description="Your account, your numbers, and how you like the till." />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-6">
          <AccountCard profile={profile.data} />
          <Appearance />
          <LogOutButtons />
        </div>
        <Tabs defaultValue="performance" className="min-w-0">
          <TabsList>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="security">Security &amp; devices</TabsTrigger>
          </TabsList>
          <TabsContent value="performance" className="mt-4">
            <Performance />
          </TabsContent>
          <TabsContent value="preferences" className="mt-4">
            {profile.data ? <PreferencesCard prefs={profile.data.preferences} /> : <Skeleton className="h-64" />}
          </TabsContent>
          <TabsContent value="security" className="mt-4 flex flex-col gap-6">
            <PasswordCard />
            {profile.data ? <PinCard hasPin={profile.data.has_pin} /> : <Skeleton className="h-40" />}
            {profile.data ? <DevicesCard sessions={profile.data.sessions} /> : <Skeleton className="h-40" />}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- account

function AccountCard({ profile }: { profile: Profile | undefined }) {
  const me = useMe();
  const initials = me.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const a = profile?.account;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-4">
        <Avatar className="size-14 rounded-xl">
          <AvatarFallback className="rounded-xl text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{me.full_name}</CardTitle>
          <CardDescription>
            <span className="font-mono">{me.username}</span> · {a?.role ?? "Cashier"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!profile ? (
          <Skeleton className="h-24" />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              { label: "Email", value: a?.email ?? "—", wide: true },
              { label: "In the ERP since", value: a?.created_at ? dateLabel(a.created_at) : "—" },
              { label: "Logged in", value: me.last_login_at ? relative(me.last_login_at) : "—" },
              { label: "Discount limit", value: `${me.max_discount_pct}%` },
              { label: "Till PIN", value: profile.has_pin ? "Set" : "Not set" },
            ].map((i) => (
              <div key={i.label} className={cn("min-w-0 space-y-0.5", i.wide && "col-span-2")}>
                <dt className="text-xs text-muted-foreground">{i.label}</dt>
                <dd className="truncate font-medium">{i.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {profile && !profile.erp_reachable && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <CloudOff className="size-3.5" /> The ERP can&apos;t be reached; showing what this till knows.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Your account lives in the ERP{me.company.name ? ` of ${me.company.name}` : ""}. Ask an ERP administrator to
          change your name or email; your password and PIN you change here.
        </p>
      </CardContent>
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
        <CardDescription>For this browser.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            variant={(theme ?? "system") === o.value ? "default" : "outline"}
            className="h-14 flex-col gap-1"
            onClick={() => setTheme(o.value)}
          >
            <o.icon /> {o.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function LogOutButtons() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const lock = useLock();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      forgetMe();
      queryClient.clear();
      router.replace("/login");
    }
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" onClick={lock}>
        <KeyRound /> Lock till
      </Button>
      <Button variant="outline" onClick={logout} disabled={busy}>
        {busy ? <Spinner /> : <LogOut />} Log out
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- performance

function Performance() {
  const stats = useQuery({ queryKey: ["me-stats"], queryFn: () => get<CashierStats>("/api/me/stats") });
  const s = stats.data;
  if (!s) return <Skeleton className="h-80" />;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Last 7 days" value={money(s.week.net)} hint={`${s.week.sales} sales · ${s.week.days_worked} day(s) worked`} />
        <StatCard label="Last 30 days" value={money(s.month.net)} hint={`${s.month.sales} sales · ${qty(s.month.items)} items`} />
        <StatCard label="Average sale" value={money(s.month.average)} hint="over 30 days" />
        <StatCard
          label="Drawer counts"
          value={s.drawer.counted_shifts ? `${s.drawer.exact} of ${s.drawer.counted_shifts} exact` : "—"}
          hint={
            s.drawer.counted_shifts
              ? s.drawer.variance === 0
                ? "No difference in 30 days"
                : `${s.drawer.variance > 0 ? "+" : "−"}${money(Math.abs(s.drawer.variance))} in total`
              : "No counted shift yet"
          }
          tone={s.drawer.variance < 0 ? "danger" : undefined}
        />
      </div>
      <DailyChart days={s.days} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What you sold most</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {s.top_products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sold yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {s.top_products.map((p) => (
                  <li key={p.name} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="tabular-nums text-muted-foreground">{qty(p.qty)}×</span> {p.name}
                    </span>
                    <span className="tabular-nums">{money(p.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Best day</CardTitle>
            <CardDescription>Your highest takings in 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {s.best_day ? (
              <div className="space-y-1">
                <p className="text-2xl font-semibold tabular-nums">{money(s.best_day.total)}</p>
                <p className="text-sm text-muted-foreground">
                  {dateLabel(s.best_day.date)} · {s.best_day.sales} sales · {qty(s.best_day.items)} items
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Takings per day for 30 days: one series in one hue (chart-1), thin bars from a shared baseline,
 * hover or focus a day for its figures, and a table view for anyone who'd rather read numbers. */
function DailyChart({ days }: { days: CashierStats["days"] }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.total), 1);
  const shown = hover === null ? null : days[hover];
  const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Takings per day</CardTitle>
          <CardDescription>Last 30 days, including PPN, before refunds</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAsTable(!asTable)}>
          <Table2 /> {asTable ? "Chart" : "Table"}
        </Button>
      </CardHeader>
      <CardContent>
        {asTable ? (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Takings</TableHead>
                  <TableHead className="text-right">Refunds</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...days].reverse().map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{dateLabel(d.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.sales}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(d.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.refunds ? `−${money(d.refunds)}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div>
            <div className="mb-2 h-5 truncate text-sm">
              {shown ? (
                <span>
                  <span className="font-medium">{dateLabel(shown.date)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {money(shown.total)} · {shown.sales} sales{shown.refunds ? ` · −${money(shown.refunds)} refunded` : ""}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Point at a day for its figures.</span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex h-40 w-12 shrink-0 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums">
                <span>{moneyShort(max)}</span>
                <span>0</span>
              </div>
              <div
                className="relative flex h-40 flex-1 items-end gap-0.5 border-b border-border"
                role="img"
                aria-label={`Takings per day over the last 30 days, highest ${money(max)}`}
                onMouseLeave={() => setHover(null)}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/60" />
                {days.map((d, i) => (
                  <button
                    key={d.date}
                    type="button"
                    aria-label={`${dateLabel(d.date)}: ${money(d.total)}`}
                    className="flex h-full flex-1 items-end focus:outline-none"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  >
                    <span
                      className={cn(
                        "block w-full rounded-t-[4px] bg-[var(--chart-1)] transition-opacity",
                        hover !== null && hover !== i && "opacity-40",
                      )}
                      style={{ height: d.total ? `${Math.max((d.total / max) * 100, 2)}%` : 0 }}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1 flex justify-between pl-14 text-xs text-muted-foreground">
              <span>{short(days[0].date)}</span>
              <span>{short(days[Math.floor(days.length / 2)].date)}</span>
              <span>Today</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- preferences

function PreferencesCard({ prefs }: { prefs: Preferences }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(prefs);
  const save = useMutation({
    mutationFn: (changes: Partial<Preferences>) => put<Preferences>("/api/me/preferences", changes),
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Saved. Every till you log in at works this way.");
    },
  });
  const set = (changes: Partial<Preferences>) => {
    setForm({ ...form, ...changes });
    save.mutate(changes);
  };
  const toggle = (key: "auto_print" | "scan_sound", label: string, hint: string) => (
    <Field orientation="horizontal" className="items-start">
      <input
        id={`pref-${key}`}
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={form[key]}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      <div>
        <FieldLabel htmlFor={`pref-${key}`}>{label}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </div>
    </Field>
  );
  const selectClass = "h-9 w-full rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30 sm:w-72";
  return (
    <Card>
      <CardHeader>
        <CardTitle>How you like the till</CardTitle>
        <CardDescription>Saved on your account, so they follow you to any till. Changes save as you make them.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {toggle("auto_print", "Print the receipt after every sale", "The receipt printer opens as soon as a sale is paid.")}
          {toggle("scan_sound", "Beep when an item goes into the cart", "Handy with a barcode scanner: you hear every scan.")}
          <Field>
            <FieldLabel htmlFor="pref-pay">The payment window starts on</FieldLabel>
            <select
              id="pref-pay"
              className={selectClass}
              value={form.default_payment}
              onChange={(e) => set({ default_payment: e.target.value as Preferences["default_payment"] })}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="qris">QRIS</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pref-lock">Lock the till by itself</FieldLabel>
            <select
              id="pref-lock"
              className={selectClass}
              value={form.auto_lock_minutes}
              onChange={(e) => set({ auto_lock_minutes: Number(e.target.value) })}
            >
              <option value={0}>Never</option>
              {[1, 2, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  After {m} minute{m > 1 ? "s" : ""} without a touch
                </option>
              ))}
            </select>
            <FieldDescription>Unlock with your PIN (see Security) or your password.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- security

function PasswordCard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const mismatch = form.again !== "" && form.next !== form.again;
  const change = useMutation({
    mutationFn: () =>
      post<{ other_devices_logged_out: number }>("/api/me/password", { current_password: form.current, new_password: form.next }),
    onSuccess: (r) => {
      setForm({ current: "", next: "", again: "" });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success(
        `Password changed in the ERP.${r.other_devices_logged_out ? ` ${r.other_devices_logged_out} other device(s) logged out.` : ""}`,
      );
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mismatch) change.mutate();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changed in the ERP, so it works on every till. Your other devices are logged out.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
              <Input id="pw-current" type="password" autoComplete="current-password" required value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pw-new">New password</FieldLabel>
              <Input id="pw-new" type="password" autoComplete="new-password" required minLength={8} value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })} />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="pw-again">New password again</FieldLabel>
              <Input id="pw-again" type="password" autoComplete="new-password" required value={form.again} aria-invalid={mismatch}
                onChange={(e) => setForm({ ...form, again: e.target.value })} />
              {mismatch && <FieldDescription className="text-destructive">The two don&apos;t match.</FieldDescription>}
            </Field>
          </FieldGroup>
          <Button type="submit" className="mt-4" disabled={change.isPending || mismatch || form.next.length < 8 || !form.again}>
            {change.isPending && <Spinner />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PinCard({ hasPin }: { hasPin: boolean }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const save = useMutation({
    mutationFn: (remove: boolean) => put("/api/me/pin", { password, pin: remove ? null : pin }),
    onSuccess: (_, remove) => {
      setPassword("");
      setPin("");
      for (const key of [["profile"], ["me"]]) queryClient.invalidateQueries({ queryKey: key });
      toast.success(remove ? "PIN removed: unlock with your password." : "PIN saved: unlock the till with it.");
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(false);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Till PIN {hasPin ? <Badge variant="secondary">Set</Badge> : <Badge variant="outline">Not set</Badge>}
        </CardTitle>
        <CardDescription>4 to 6 digits for unlocking a locked till quickly. Your password always works too.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="pin-pw">Your password</FieldLabel>
              <Input id="pin-pw" type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pin-new">{hasPin ? "New PIN" : "PIN"}</FieldLabel>
              <Input id="pin-new" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </FieldGroup>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={save.isPending || !password || pin.length < 4}>
              {save.isPending && <Spinner />} {hasPin ? "Change PIN" : "Set PIN"}
            </Button>
            {hasPin && (
              <Button type="button" variant="outline" disabled={save.isPending || !password} onClick={() => save.mutate(true)}>
                Remove PIN
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** "Chrome on Windows" from a user-agent string: enough to recognise a device. */
function deviceName(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "A browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "another system";
  return { label: `${browser} on ${os}`, mobile: /Mobile|Android|iPhone|iPad/.test(ua) };
}

function DevicesCard({ sessions }: { sessions: DeviceSession[] }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["profile"] });
  const endOne = useMutation({
    mutationFn: (id: string) => del(`/api/me/sessions/${id}`),
    onSuccess: () => {
      refresh();
      toast.success("Logged out there.");
    },
  });
  const endOthers = useMutation({
    mutationFn: () => api<{ logged_out: number }>("/api/me/sessions/others", { method: "DELETE" }),
    onSuccess: (r) => {
      refresh();
      toast.success(`${r.logged_out} other device(s) logged out.`);
    },
  });
  const others = sessions.filter((s) => !s.current).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Where you are logged in</CardTitle>
          <CardDescription>Log out a till you forgot, or everywhere but here.</CardDescription>
        </div>
        {others > 0 && (
          <Button variant="outline" size="sm" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
            {endOthers.isPending && <Spinner />} Log out the others
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {sessions.map((s) => {
            const d = deviceName(s.user_agent);
            const Icon = d.mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {d.label} {s.current && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Active {relative(s.last_seen_at)} · logged in {relative(s.created_at)}
                  </div>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" disabled={endOne.isPending} onClick={() => endOne.mutate(s.id)}>
                    Log out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
