"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { api, ApiError, isUnreachable } from "./api";

export type Me = {
  id: number;
  username: string;
  full_name: string;
  last_login_at: string | null;
  shift: {
    id: number;
    number: string;
    opened_at: string;
    /** When the shift ends by itself (the shop's closing time); null when there is none. */
    ends_at: string | null;
    store: { id: number; code: string; name: string };
  } | null;
  /** "17:00": shifts end then and none opens until tomorrow. */
  shift_end_time: string | null;
  after_hours: boolean;
  company: {
    name: string;
    address: string;
    phone: string;
    tax_id: string;
    tax_rate: number;
    currency: string;
    receipt_footer: string;
  };
  max_discount_pct: number;
  /** Taking more than this out of the drawer at once needs a supervisor. */
  cash_out_approval_above: number;
  return_days: number;
  low_stock_at: number;
  email_receipts: boolean;
  /** earn_per: rupiah per point earned (0: none). point_value: rupiah a point pays. */
  loyalty: { earn_per: number; point_value: number };
  walk_in_customer_id: number | null;
  erp_ready: boolean;
};

const AuthContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(AuthContext);
  if (!me) throw new Error("useMe outside AuthProvider");
  return me;
}

const ME_KEY = "pos-me";

/** Who is logged in. When the POS server can't be reached the till keeps the last answer, so it
 * can go on selling offline; only a real "not logged in" sends the cashier to the login page. */
async function loadMe(): Promise<Me> {
  try {
    const me = await api<Me>("/api/auth/me");
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(me));
    } catch {}
    return me;
  } catch (e) {
    if (e instanceof ApiError && isUnreachable(e)) {
      try {
        const cached = localStorage.getItem(ME_KEY);
        if (cached) return JSON.parse(cached) as Me;
      } catch {}
    }
    throw e;
  }
}

export function forgetMe() {
  try {
    localStorage.removeItem(ME_KEY);
  } catch {}
}

export function AuthProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const { data, isError } = useQuery({ queryKey: ["me"], queryFn: loadMe, retry: false });

  useEffect(() => {
    if (isError) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [isError, router]);

  if (!data) return <>{fallback}</>;
  return <AuthContext.Provider value={data}>{children}</AuthContext.Provider>;
}
