"use client";

/** The customer-facing display: a second window (on a second screen) that shows the cart as it is
 * scanned and the change at the end. The till talks to it over a BroadcastChannel, so it needs no
 * login and no server: both windows are in the same browser. */

export type DisplayLine = { key: string; name: string; qty: number; total: number; promo: string | null; free: boolean };

export type DisplayState =
  | { kind: "idle"; company: string; store: string }
  | {
      kind: "cart";
      company: string;
      store: string;
      customer: string | null;
      lines: DisplayLine[];
      discount: number;
      tax: number;
      total: number;
    }
  | { kind: "paid"; company: string; store: string; total: number; change: number; points: number };

const CHANNEL = "pos-customer-display";
const LAST = "pos-display-last";

export function publishDisplay(state: DisplayState) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    localStorage.setItem(LAST, JSON.stringify(state));
  } catch {}
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(state);
  channel.close();
}

export function lastDisplay(): DisplayState | null {
  try {
    const raw = localStorage.getItem(LAST);
    return raw ? (JSON.parse(raw) as DisplayState) : null;
  } catch {
    return null;
  }
}

export function onDisplay(callback: (state: DisplayState) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e) => callback(e.data as DisplayState);
  return () => channel.close();
}

export function openDisplay() {
  window.open("/display", "pos-customer-display", "width=1024,height=700");
}
