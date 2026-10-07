"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEMO = { username: "cashier", label: "Demo cashier" };
const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function login(creds: { username: string; password: string }) {
    setBusy(creds.username);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: creds });
      queryClient.removeQueries();
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    login({ username, password });
  }

  return (
    // The whole window: the brand panel on the left, the form on the right (stacked on a phone).
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      <BrandPanel />
      <div className="flex items-center justify-center p-8 sm:p-12">
        {/* Big screens: the form grows with the window. */}
        <div className="w-full max-w-105 min-[1800px]:[zoom:1.25] min-[2400px]:[zoom:1.5] min-[3200px]:[zoom:2]">
          <div className="mb-6">
            <h1 className="text-[28px] leading-tight font-bold tracking-tight">Sign in</h1>
            <p className="mt-1 text-muted-foreground">Use your cashier account from the ERP.</p>
          </div>

          <form onSubmit={submit}>
            <FieldGroup className="gap-5">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="username" className="font-semibold">
                  Username
                </FieldLabel>
                <InputGroup className="h-13 rounded-xl">
                  <InputGroupInput
                    id="username"
                    className="px-4 text-[15px]"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="username"
                    placeholder="e.g. cashier"
                    required
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="password" className="font-semibold">
                  Password
                </FieldLabel>
                <InputGroup className="h-13 rounded-xl">
                  <InputGroupInput
                    id="password"
                    className="px-4 text-[15px]"
                    type={shown ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end" className="pr-3">
                    <InputGroupButton size="icon-xs" aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown(!shown)}>
                      {shown ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Button type="submit" size="lg" className="mt-1 h-14 rounded-xl text-base font-bold" disabled={busy !== null}>
                {busy === username && <Spinner />} Sign in
              </Button>
              <FieldSeparator>Or try the demo</FieldSeparator>
              <Button
                type="button"
                variant="outline"
                className="h-12 justify-between rounded-xl px-4"
                disabled={busy !== null}
                onClick={() => login({ username: DEMO.username, password: DEMO_PASSWORD })}
              >
                <span className="flex items-center gap-2">
                  {busy === DEMO.username && <Spinner />}
                  {DEMO.label}
                </span>
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {DEMO.username} / {DEMO_PASSWORD}
                </span>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                No account? Cashier accounts are made in the ERP, under Settings → Users.
              </p>
            </FieldGroup>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Navy, like the till's rail: the product's promise, and whether the POS server answers. */
function BrandPanel() {
  const server = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/api/health", { cache: "no-store" })).ok,
    refetchInterval: 30_000,
    retry: false,
  });
  const online = server.data === true;
  return (
    <div className="flex flex-col justify-between gap-8 bg-sidebar p-8 text-white sm:p-12 lg:p-14">
      <div className="flex items-center gap-3 min-[1800px]:[zoom:1.25] min-[2400px]:[zoom:1.5] min-[3200px]:[zoom:2]">
        <span className="flex size-12 items-center justify-center rounded-xl bg-sidebar-primary">
          <ShoppingCart className="size-6" />
        </span>
        <div className="leading-tight">
          <div className="text-xl font-bold">POS</div>
          <div className="text-sm text-sidebar-foreground">Point of sale</div>
        </div>
      </div>
      <div className="max-w-md min-[1800px]:[zoom:1.25] min-[2400px]:[zoom:1.5] min-[3200px]:[zoom:2]">
        <h2 className="hidden text-[44px] leading-[1.08] font-extrabold tracking-tight sm:block">
          Fast checkout. One source of truth in the ERP.
        </h2>
        <p className="mt-0 text-[15px] leading-relaxed text-[#c8cede] sm:mt-6">
          Products, prices, stock and customers come from the ERP. Every sale goes back to it as a sales order, even
          when the network drops for a while.
        </p>
        <dl className="mt-6 hidden space-y-2.5 rounded-xl bg-sidebar-accent/70 px-5 py-4 text-sm sm:block">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#c8cede]">POS server</dt>
            <dd className="flex items-center gap-2 font-semibold">
              <span className={cn("size-2 rounded-full", server.isPending ? "bg-sidebar-foreground" : online ? "bg-[#4ade80]" : "bg-[#f87171]")} />
              {server.isPending ? "Checking…" : online ? "Online" : "Can't reach it"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#c8cede]">Your account</dt>
            <dd className="font-semibold">Checked by the ERP</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
