"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";

const DEMO = [{ username: "cashier", role: "Cashier", note: "open a shift and sell" }];
const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-svh items-center justify-center bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-semibold">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">P</div>
          POS
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Start selling</CardTitle>
            <CardDescription>Log in with your cashier account from the ERP</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <FieldLabel htmlFor="username">Username</FieldLabel>
                  <Input
                    id="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="username"
                    placeholder="e.g. cashier"
                    required
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={busy !== null}>
                    {busy === username && <Spinner />} Log in
                  </Button>
                </Field>
                <FieldSeparator>Or try the demo</FieldSeparator>
                <div className="grid gap-2">
                  {DEMO.map((d) => (
                    <Button
                      key={d.username}
                      type="button"
                      variant="outline"
                      className="h-auto justify-between py-2"
                      disabled={busy !== null}
                      onClick={() => login({ username: d.username, password: DEMO_PASSWORD })}
                    >
                      <span className="flex items-center gap-2">
                        {busy === d.username && <Spinner />}
                        <Badge variant="secondary">{d.role}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{d.username}</span>
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{d.note}</span>
                    </Button>
                  ))}
                </div>
                <FieldDescription className="text-center">
                  The demo cashier uses the password <code>{DEMO_PASSWORD}</code>. Cashier accounts are made in
                  the ERP under Settings → Users.
                </FieldDescription>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
