"use client";

import { ShoppingBag, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { lastDisplay, onDisplay, type DisplayState } from "@/lib/display";
import { money } from "@/lib/format";

/** The screen facing the customer. Opened from the till (it fills itself from there), no login. */
export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState | null>(() => (typeof window === "undefined" ? null : lastDisplay()));
  useEffect(() => onDisplay(setState), []);

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-8 py-5">
        <div>
          <div className="text-2xl font-semibold">{state?.company || "Welcome"}</div>
          {state?.store && <div className="text-muted-foreground">{state.store}</div>}
        </div>
        {state?.kind === "cart" && state.customer && <div className="text-lg text-muted-foreground">Hello, {state.customer}</div>}
      </header>

      {!state || state.kind === "idle" ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <ShoppingBag className="size-16" />
          <p className="text-3xl">Welcome!</p>
          <p className="text-lg">Your items will appear here as they are scanned.</p>
        </main>
      ) : state.kind === "paid" ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-6">
          <p className="text-3xl text-muted-foreground">Thank you!</p>
          <p className="text-5xl font-semibold tabular-nums">{money(state.total)}</p>
          {state.change > 0 && (
            <p className="text-4xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">Your change {money(state.change)}</p>
          )}
          {state.points > 0 && <p className="text-xl text-muted-foreground">You earned {state.points.toLocaleString("id-ID")} points</p>}
        </main>
      ) : (
        <main className="flex min-h-0 flex-1">
          <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto px-8 py-4 text-xl">
            {state.lines.map((l) => (
              <li key={l.key} className="flex items-start justify-between gap-6 py-3">
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="tabular-nums text-muted-foreground">{l.qty} ×</span> {l.name}
                  </div>
                  {l.promo && (
                    <div className="mt-1 flex items-center gap-1 text-base text-emerald-700 dark:text-emerald-400">
                      <Tag className="size-4" /> {l.free ? `Free · ${l.promo}` : l.promo}
                    </div>
                  )}
                </div>
                <div className="shrink-0 font-medium tabular-nums">{l.free ? "Free" : money(l.total)}</div>
              </li>
            ))}
          </ul>
          <aside className="flex w-[26rem] shrink-0 flex-col justify-end gap-3 border-l bg-muted/40 p-8 text-xl">
            {state.discount > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>You save</span>
                <span className="tabular-nums">{money(state.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>PPN</span>
              <span className="tabular-nums">{money(state.tax)}</span>
            </div>
            <div className="flex justify-between border-t pt-4 text-4xl font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(state.total)}</span>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}
