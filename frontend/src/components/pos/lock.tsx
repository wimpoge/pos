"use client";

import { useMutation } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, post } from "@/lib/api";
import { useMe } from "@/lib/auth";

const LockContext = createContext<() => void>(() => {});

/** "Lock till" for a cashier stepping away: the screen is covered until their PIN (or password) is
 * entered. It survives a reload, and comes on by itself after the idle time they chose. */
export function LockProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const key = `pos-locked-${me.id}`;
  const [locked, setLocked] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const lock = useCallback(() => {
    try {
      localStorage.setItem(key, "1");
    } catch {}
    setLocked(true);
  }, [key]);
  const unlock = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
    setLocked(false);
  }, [key]);

  // Auto-lock after the cashier's idle time; any key, click or touch counts as activity.
  const minutes = me.preferences.auto_lock_minutes;
  const lastActive = useRef(0);
  useEffect(() => {
    if (!minutes || locked) return;
    lastActive.current = Date.now();
    const seen = () => (lastActive.current = Date.now());
    const events = ["keydown", "pointerdown", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    const tick = setInterval(() => Date.now() - lastActive.current > minutes * 60_000 && lock(), 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
      clearInterval(tick);
    };
  }, [minutes, locked, lock]);

  return (
    <LockContext.Provider value={lock}>
      {children}
      {locked && <LockScreen onUnlocked={unlock} />}
    </LockContext.Provider>
  );
}

export const useLock = () => useContext(LockContext);

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const me = useMe();
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => post("/api/me/unlock", { secret }),
    onSuccess: onUnlocked,
    onError: (e) => {
      setSecret("");
      if (e instanceof ApiError && e.status === 423 && e.message.includes("Log in again")) {
        onUnlocked(); // the session is gone; a fresh login should not open on a locked screen
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (secret) check.mutate();
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Till locked" className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Lock className="size-6" />
        </span>
        <div>
          <p className="text-lg font-semibold">Till locked</p>
          <p className="text-sm text-muted-foreground">
            {me.full_name}: enter your {me.has_pin ? "PIN or password" : "password"} to carry on.
          </p>
        </div>
        <Input
          autoFocus
          type="password"
          inputMode={me.has_pin ? "numeric" : undefined}
          autoComplete="off"
          aria-label={me.has_pin ? "PIN or password" : "Password"}
          className="h-12 text-center text-lg tracking-widest"
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={!secret || check.isPending}>
          {check.isPending && <Spinner />} Unlock
        </Button>
        <a href="/login" className="text-xs text-muted-foreground underline underline-offset-4">
          Not {me.full_name.split(" ")[0]}? Log in as someone else
        </a>
      </form>
    </div>
  );
}
