"use client";

/**
 * Sales rung up while the POS server can't be reached. Each is kept in this browser with its own
 * id and sent when the server answers again; the server books an id once, so sending twice (a
 * reply lost on the way back) is harmless. The prices are the ones the customer paid.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ApiError, isUnreachable, post } from "./api";
import type { Sale } from "./types";

export type CheckoutBody = {
  public_id: string;
  customer_id: number | null;
  lines: { product_id: number; qty: number; discount_pct: number | null; unit_price?: number; promo?: string | null }[];
  payments: { method: string; amount: number; reference: string | null }[];
  voucher_code?: string | null;
  offline?: { sold_at: string; shift_id: number };
};

export type QueuedSale = { body: CheckoutBody; total: number; queuedAt: string; error?: string };

const KEY = "pos-offline-sales";
const EVENT = "pos-offline-change";

function read(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedSale[];
  } catch {
    return [];
  }
}

function write(items: QueuedSale[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

let cache: QueuedSale[] | null = null;
const snapshot = () => (cache ??= read());
const EMPTY: QueuedSale[] = [];

function subscribe(callback: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      callback();
    }
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function queueSale(body: CheckoutBody, total: number) {
  write([...read(), { body, total, queuedAt: new Date().toISOString() }]);
}

let flushing = false;

/** Send what is waiting, oldest first. Stops at the first sign the server is still away. */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of read()) {
      try {
        await post<Sale>("/api/sales", item.body);
        write(read().filter((q) => q.body.public_id !== item.body.public_id));
        sent += 1;
      } catch (e) {
        if (isUnreachable(e)) break;
        // The server looked at it and said no: keep it, with why, for a person to decide.
        const message = e instanceof ApiError ? e.message : String(e);
        write(read().map((q) => (q.body.public_id === item.body.public_id ? { ...q, error: message } : q)));
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function discardQueued(publicId: string) {
  write(read().filter((q) => q.body.public_id !== publicId));
}

/** The waiting sales, and a quiet retry every 20 seconds while there are any. */
export function useOfflineQueue(onSent?: (n: number) => void) {
  const items = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const flush = useCallback(async () => {
    const n = await flushQueue();
    if (n) onSent?.(n);
    return n;
  }, [onSent]);
  useEffect(() => {
    if (!items.some((q) => !q.error)) return;
    const t = setInterval(flush, 20_000);
    window.addEventListener("online", flush);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", flush);
    };
  }, [items, flush]);
  return { items, flush };
}

/** A UUID v4. crypto.randomUUID only exists on HTTPS or localhost; a till on the shop's LAN may be neither. */
export function newSaleId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
