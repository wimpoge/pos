/** The ERP's arithmetic (whole rupiah, half up) and the POS's promotion rules, so the cart shows
 * what the ERP will invoice. The POS API prices everything again (services/pricing.py); keep the
 * two in step. */

import type { Promotion } from "./types";

const divRound = (numerator: number, denominator: number) => Math.floor((numerator * 2 + denominator) / (denominator * 2));

export const lineAmount = (qty: number, unitPrice: number, discountPct = 0) =>
  divRound(qty * unitPrice * (100 - discountPct), 100);

export const taxAmount = (subtotal: number, ratePct: number) => divRound(subtotal * ratePct, 100);

export type CartLine = {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category?: string | null;
  qty: number;
  /** null: the customer's group discount applies */
  discountPct: number | null;
};

export type PricedLine = {
  key: string;
  productId: number;
  name: string;
  unit: string;
  listPrice: number;
  qty: number;
  unitPrice: number;
  discount: number;
  promo: string | null;
  /** Priced by the cashier's own discount. */
  manual: boolean;
  free: boolean;
  total: number;
};

/** The till's calendar date; the till stands in the shop, so this is the shop's date. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function runs(p: Promotion, storeId: number, on: string) {
  return (p.store_id === null || p.store_id === storeId) && (!p.starts_on || p.starts_on <= on) && (!p.ends_on || p.ends_on >= on);
}

function covers(p: Promotion, line: CartLine) {
  if (p.kind === "voucher") return true;
  if (p.product_id !== null) return p.product_id === line.productId;
  if (p.category !== null) return p.category === (line.category ?? null);
  return p.kind === "percent";
}

type Option = [unitPrice: number, discount: number, promo: string | null, manual: boolean];

/** The cheapest price for the customer; on a tie, the cashier's or group's discount. */
function best(line: CartLine, qty: number, groupPct: number, rules: Promotion[], voucher: Promotion | null): Option {
  const options: Option[] = [line.discountPct !== null ? [line.price, line.discountPct, null, true] : [line.price, groupPct, null, false]];
  for (const r of rules) {
    if (r.kind === "percent") options.push([line.price, r.value, r.name, false]);
    else if (r.kind === "price" && r.value < line.price) options.push([r.value, 0, r.name, false]);
  }
  if (voucher) options.push([line.price, voucher.value, voucher.name, false]);
  let pick = options[0];
  for (const o of options.slice(1)) if (lineAmount(qty, o[0], o[1]) < lineAmount(qty, pick[0], pick[1])) pick = o;
  return pick;
}

function price(lines: CartLine[], groupPct: number, rules: Promotion[], voucher: Promotion | null): PricedLine[] {
  const out: PricedLine[] = [];
  for (const line of lines) {
    const covering = rules.filter((r) => r.kind !== "voucher" && covers(r, line));
    const freeRule = covering.find((r) => r.kind === "buy_get" && r.buy_qty > 0 && r.get_qty > 0);
    const free = freeRule ? Math.floor(line.qty / (freeRule.buy_qty + freeRule.get_qty)) * freeRule.get_qty : 0;
    const paid = line.qty - free;
    const base = { productId: line.productId, name: line.name, unit: line.unit, listPrice: line.price };
    if (paid) {
      const [unitPrice, discount, promo, manual] = best(line, paid, groupPct, covering, voucher);
      out.push({ ...base, key: `${line.productId}`, qty: paid, unitPrice, discount, promo, manual, free: false, total: lineAmount(paid, unitPrice, discount) });
    }
    if (free && freeRule) {
      out.push({ ...base, key: `${line.productId}-free`, qty: free, unitPrice: line.price, discount: 100, promo: freeRule.name, manual: false, free: true, total: 0 });
    }
  }
  return out;
}

export type CartTotals = {
  lines: PricedLine[];
  gross: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
  /** The voucher that applies, or why the code given doesn't. */
  voucher: Promotion | null;
  voucherError: string | null;
};

export function cartTotals(
  lines: CartLine[],
  customerDiscount: number,
  taxRate: number,
  opts: { promotions?: Promotion[]; storeId?: number; voucherCode?: string | null } = {},
): CartTotals {
  const on = todayIso();
  const running = (opts.promotions ?? []).filter((p) => runs(p, opts.storeId ?? 0, on));
  let priced = price(lines, customerDiscount, running, null);
  let voucher: Promotion | null = null;
  let voucherError: string | null = null;
  const code = (opts.voucherCode ?? "").trim().toUpperCase();
  if (code) {
    const found = running.find((p) => p.kind === "voucher" && (p.code ?? "").toUpperCase() === code);
    const spend = priced.reduce((s, l) => s + l.total, 0);
    if (!found) voucherError = `Voucher ${code} is not valid here today.`;
    else if (spend < found.min_spend) voucherError = `${code} needs a spend of Rp ${found.min_spend.toLocaleString("id-ID")} before tax.`;
    else {
      voucher = found;
      priced = price(lines, customerDiscount, running, found);
    }
  }
  // As the server counts it: before discounts, at the price charged (a special price is not a discount).
  const gross = priced.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const subtotal = priced.reduce((s, l) => s + l.total, 0);
  const tax = taxAmount(subtotal, taxRate);
  return { lines: priced, gross, discount: gross - subtotal, subtotal, tax, total: subtotal + tax, voucher, voucherError };
}

/** Notes a customer is likely to hand over for `total`: exact, then the next round amounts. */
export function cashSuggestions(total: number): number[] {
  const out = new Set<number>([total]);
  for (const step of [10_000, 20_000, 50_000, 100_000]) out.add(Math.ceil(total / step) * step);
  return [...out].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
}
