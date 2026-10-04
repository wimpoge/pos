"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Keyboard,
  MonitorSmartphone,
  Minus,
  PackageSearch,
  PauseCircle,
  Plus,
  RefreshCw,
  ScanBarcode,
  ShoppingCart,
  Tag,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApproval } from "@/components/pos/approval";
import { CustomerPicker } from "@/components/pos/customer-picker";
import { HeldCartsSheet, useHeldCarts } from "@/components/pos/held-carts";
import { LowStockSheet } from "@/components/pos/low-stock";
import { PaymentDialog, type PaymentRow } from "@/components/pos/payment-dialog";
import { ProductImage } from "@/components/pos/product-image";
import { printReceipt, ReceiptDialog } from "@/components/pos/receipt-dialog";
import { ShortcutsDialog } from "@/components/pos/shortcuts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { get, isUnreachable, post } from "@/lib/api";
import { useMe, type Me } from "@/lib/auth";
import { openDisplay, publishDisplay } from "@/lib/display";
import { money, qty as fmtQty } from "@/lib/format";
import { newSaleId, queueSale, type CheckoutBody } from "@/lib/offline";
import { cartTotals, type CartLine, type CartTotals } from "@/lib/pricing";
import type { Catalog, CatalogProduct, Customer, HeldCart, PaymentMethod, Sale, SyncRun } from "@/lib/types";
import { cn } from "@/lib/utils";

type SavedCart = { lines: CartLine[]; customer: Customer | null; voucher: string };
const EMPTY_CART: SavedCart = { lines: [], customer: null, voucher: "" };

function loadSaved<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {}
  return fallback;
}

/** The catalogue, kept in this browser too, so the till still sells when the server is away. */
function useCatalog(storeId: number) {
  const key = `pos-catalog-${storeId}`;
  return useQuery({
    queryKey: ["catalog", storeId],
    queryFn: async () => {
      try {
        const catalog = await get<Catalog>(`/api/stores/${storeId}/catalog`);
        try {
          localStorage.setItem(key, JSON.stringify(catalog));
        } catch {}
        return catalog;
      } catch (e) {
        if (isUnreachable(e)) {
          try {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw) as Catalog;
          } catch {}
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

/** A receipt for a sale the server has not seen yet, from what the till knows. */
function offlineReceipt(
  body: CheckoutBody,
  totals: CartTotals,
  me: Me,
  store: Catalog["store"],
  customer: Customer | null,
  tendered: number,
  change: number,
): Sale {
  const payments = body.payments
    .map((p) => ({ method: p.method as PaymentMethod, amount: p.method === "cash" ? p.amount - change : p.amount, reference: p.reference }))
    .filter((p) => p.amount > 0);
  return {
    id: 0,
    number: `OFFLINE ${body.public_id.slice(0, 8).toUpperCase()}`,
    created_at: new Date().toISOString(),
    business_date: new Date().toISOString().slice(0, 10),
    store: { id: store.id, code: store.code, name: store.name },
    cashier: { id: me.id, full_name: me.full_name },
    customer: customer ? { id: customer.id, code: customer.code, name: customer.name } : { id: 0, code: "", name: "Walk-in customer" },
    total: totals.total,
    items: totals.lines.reduce((n, l) => n + l.qty, 0),
    methods: payments.map((p) => p.method),
    refunded: 0,
    voided: false,
    offline: true,
    erp: { status: "pending", order_number: null, invoice_number: null, error: null, attempts: 0, last_attempt_at: null, synced_at: null },
    shift: { id: me.shift?.id ?? 0, number: me.shift?.number ?? "" },
    tax_rate: me.company.tax_rate,
    gross: totals.gross,
    discount: totals.discount,
    subtotal: totals.subtotal,
    tax: totals.tax,
    cash_tendered: tendered,
    change_due: change,
    note: null,
    external_id: body.public_id,
    voucher_code: totals.voucher?.code ?? null,
    approved_by: null,
    points_earned: 0,
    points_redeemed: 0,
    customer_email: null,
    voided_at: null,
    lines: totals.lines.map((l, i) => ({
      id: i, product_id: l.productId, sku: "", name: l.name, qty: l.qty, unit_price: l.unitPrice,
      discount_pct: l.discount, line_total: l.total, promo: l.promo, returned: 0,
    })),
    payments,
    returns: [],
  };
}

/** A short beep for a scan, when the cashier wants one. */
let audio: AudioContext | null = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1200;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.06);
  } catch {}
}

export function Till({ storeId }: { storeId: number }) {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const withApproval = useApproval();
  const searchRef = useRef<HTMLInputElement>(null);
  const voucherRef = useRef<HTMLInputElement>(null);
  const cartKey = `pos-cart-${me.id}-${storeId}`;

  const catalog = useCatalog(storeId);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // The cart survives a reload: a refreshed tab must not lose a half-scanned basket.
  const [cart, setCart] = useState<SavedCart>(() => (typeof window === "undefined" ? EMPTY_CART : loadSaved(cartKey, EMPTY_CART)));
  useEffect(() => {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {}
  }, [cart, cartKey]);

  const [picking, setPicking] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [paying, setPaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const [lowStock, setLowStock] = useState(false);
  const [help, setHelp] = useState(false);
  const [receipt, setReceipt] = useState<{ sale: Sale; offline: boolean } | null>(null);
  // One id per sale: a retry after a lost reply books it once.
  const [saleId, setSaleId] = useState(newSaleId);

  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!category || p.category === category) &&
        (!term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          (p.barcode ?? "").includes(term) ||
          (p.brand ?? "").toLowerCase().includes(term)),
    );
  }, [products, search, category]);
  /** The promotion to mention on a product's tile. */
  const promoFor = useMemo(() => {
    const map = new Map<number, string>();
    for (const promo of catalog.data?.promotions ?? []) {
      if (promo.kind === "voucher") continue;
      for (const p of products) {
        const covered = promo.product_id !== null ? promo.product_id === p.id
          : promo.category !== null ? promo.category === p.category : promo.kind === "percent";
        if (covered && !map.has(p.id)) map.set(p.id, promo.name);
      }
    }
    return map;
  }, [catalog.data, products]);

  const customerDiscount = cart.customer?.discount_pct ?? 0;
  const totals = cartTotals(
    cart.lines.map((l) => ({ ...l, category: byId.get(l.productId)?.category ?? l.category ?? null })),
    customerDiscount,
    me.company.tax_rate,
    { promotions: catalog.data?.promotions, storeId, voucherCode: cart.voucher },
  );
  const inCart = (id: number) => cart.lines.find((l) => l.productId === id)?.qty ?? 0;
  const lowCount = products.filter((p) => p.available <= me.low_stock_at).length;
  const held = useHeldCarts();
  const heldCount = held.data?.length ?? 0;
  const storeName = catalog.data?.store.name ?? "";

  // What the customer sees on the second screen.
  useEffect(() => {
    if (receipt) return;
    const base = { company: me.company.name, store: storeName };
    publishDisplay(
      totals.lines.length
        ? {
            kind: "cart", ...base, customer: cart.customer?.name ?? null, discount: totals.discount, tax: totals.tax, total: totals.total,
            lines: totals.lines.map((l) => ({ key: l.key, name: l.name, qty: l.qty, total: l.total, promo: l.promo, free: l.free })),
          }
        : { kind: "idle", ...base },
    );
  }, [totals.lines, totals.discount, totals.tax, totals.total, cart.customer, receipt, me.company.name, storeName]);

  function add(p: CatalogProduct, n = 1) {
    if (inCart(p.id) + n > p.available) {
      toast.warning(`Only ${fmtQty(p.available)} ${p.unit} of ${p.name} in stock here.`);
      return;
    }
    if (me.preferences.scan_sound) beep();
    setCart((c) => {
      const existing = c.lines.find((l) => l.productId === p.id);
      // The item just scanned goes to the bottom: + and − work on the last one.
      const lines = existing
        ? [...c.lines.filter((l) => l.productId !== p.id), { ...existing, qty: existing.qty + n }]
        : [...c.lines, { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, price: p.price, category: p.category, qty: n, discountPct: null }];
      return { ...c, lines };
    });
  }

  function setQty(productId: number, qty: number) {
    const p = byId.get(productId);
    if (p && qty > p.available) {
      toast.warning(`Only ${fmtQty(p.available)} ${p.unit} of ${p.name} in stock here.`);
      return;
    }
    setCart((c) => ({
      ...c,
      lines: qty <= 0 ? c.lines.filter((l) => l.productId !== productId) : c.lines.map((l) => (l.productId === productId ? { ...l, qty } : l)),
    }));
  }

  function setDiscount(productId: number, value: string) {
    const pct = value === "" ? null : Math.max(0, Math.min(100, Number(value.replace(/\D/g, "")) || 0));
    setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.productId === productId ? { ...l, discountPct: pct } : l)) }));
  }

  /** Enter in the search box: a barcode scanner types the code and presses Enter. */
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") setSearch("");
    const last = cart.lines[cart.lines.length - 1];
    if (!search && last && (e.key === "+" || e.key === "-")) {
      e.preventDefault();
      setQty(last.productId, last.qty + (e.key === "+" ? 1 : -1));
      return;
    }
    if (e.key !== "Enter") return;
    const term = search.trim().toLowerCase();
    if (!term) return;
    const exact = products.find((p) => p.barcode === term || p.sku.toLowerCase() === term);
    const hit = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (hit) {
      add(hit);
      setSearch("");
    } else if (!visible.length) {
      toast.error(`Nothing found for “${search.trim()}”.`);
    }
  }

  const refreshStock = useMutation({
    mutationFn: () => post<SyncRun>("/api/sync"),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ["catalog", storeId] });
      if (run.errors.length) toast.error(run.errors.join("\n"));
      else toast.success("Stock and promotions are up to date with the ERP.");
    },
  });

  function clearCart() {
    setCart(EMPTY_CART);
    setSaleId(newSaleId());
  }

  const hold = useMutation({
    mutationFn: () =>
      post<HeldCart>("/api/held-carts", {
        customer_id: cart.customer?.id ?? null,
        voucher_code: cart.voucher || null,
        note: cart.customer?.name ?? null,
        lines: cart.lines.map((l) => ({ product_id: l.productId, qty: l.qty, discount_pct: l.discountPct })),
      }),
    onSuccess: () => {
      clearCart();
      queryClient.invalidateQueries({ queryKey: ["held-carts"] });
      toast.success("Cart on hold. F7 brings it back.");
      searchRef.current?.focus();
    },
  });

  function resume(h: HeldCart) {
    const lines: CartLine[] = [];
    for (const l of h.lines) {
      const p = byId.get(l.product_id);
      if (!p) {
        toast.warning("A product on that cart is no longer sold; it was left out.");
        continue;
      }
      lines.push({ productId: p.id, sku: p.sku, name: p.name, unit: p.unit, price: p.price, category: p.category, qty: l.qty, discountPct: l.discount_pct });
    }
    setCart({ lines, customer: h.customer, voucher: h.voucher_code ?? "" });
    setSaleId(newSaleId());
  }

  /** The picked customer, then their points balance fresh from the ERP. */
  function pickCustomer(c: Customer | null) {
    setCart((cur) => ({ ...cur, customer: c }));
    if (!c) return;
    get<Customer>(`/api/customers/${c.id}`)
      .then((fresh) => setCart((cur) => (cur.customer?.id === fresh.id ? { ...cur, customer: fresh } : cur)))
      .catch(() => {});
  }

  function finish(sale: Sale, offline: boolean) {
    setPaying(false);
    setReceipt({ sale, offline });
    if (!offline && me.preferences.auto_print) printReceipt(sale.id);
    clearCart();
    publishDisplay({ kind: "paid", company: me.company.name, store: storeName, total: sale.total, change: sale.change_due, points: sale.points_earned });
    for (const key of [["catalog", storeId], ["sales-summary"], ["sales"], ["shift"]]) queryClient.invalidateQueries({ queryKey: key });
  }

  const checkout = useMutation({
    mutationFn: async (payments: PaymentRow[]) => {
      const body: CheckoutBody = {
        public_id: saleId,
        customer_id: cart.customer?.id ?? null,
        voucher_code: cart.voucher || null,
        lines: cart.lines.map((l) => ({ product_id: l.productId, qty: l.qty, discount_pct: l.discountPct })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference || null })),
      };
      try {
        return { sale: await withApproval((approval) => post<Sale>("/api/sales", { ...body, approval })), offline: false };
      } catch (e) {
        if (!isUnreachable(e) || !me.shift || !catalog.data) throw e;
        if (payments.some((p) => p.method === "points")) throw new Error("Points can't be spent while the till is offline. Pay another way.");
        // The server is away: keep the sale here, exactly as priced, and send it when it is back.
        const tendered = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
        const nonCash = payments.filter((p) => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
        const change = Math.max(tendered - Math.max(totals.total - nonCash, 0), 0);
        const offlineBody: CheckoutBody = {
          ...body,
          voucher_code: totals.voucher?.code ?? null,
          lines: totals.lines.map((l) => ({ product_id: l.productId, qty: l.qty, discount_pct: l.discount, unit_price: l.unitPrice, promo: l.promo })),
          offline: { sold_at: new Date().toISOString(), shift_id: me.shift.id },
        };
        queueSale(offlineBody, totals.total);
        return { sale: offlineReceipt(offlineBody, totals, me, catalog.data.store, cart.customer, tendered, change), offline: true };
      }
    },
    onSuccess: ({ sale, offline }) => finish(sale, offline),
  });

  /** The voucher field is in the cart drawer: open it, then focus the field once it is there. */
  function focusVoucher() {
    setDrawer(true);
    setTimeout(() => voucherRef.current?.focus(), 150);
  }

  function pay() {
    if (!cart.lines.length || !me.erp_ready) return;
    if (totals.voucherError) {
      toast.error(totals.voucherError);
      focusVoucher();
      return;
    }
    setDrawer(false);
    setPaying(true);
  }

  // Function keys work anywhere on the till (F1 lists them).
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (paying || receipt) return;
      const actions: Record<string, () => void> = {
        F1: () => setHelp(true),
        F2: () => searchRef.current?.focus(),
        F4: () => setPicking(true),
        F6: () => {
          if (cart.lines.length && !hold.isPending) hold.mutate();
        },
        F7: () => setHolding(true),
        F3: () => setDrawer(true),
        F8: focusVoucher,
        F9: pay,
        F10: () => router.push("/returns"),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const maxDiscount = me.max_discount_pct;
  const itemCount = cart.lines.reduce((n, l) => n + l.qty, 0);
  const wallet =
    cart.customer && cart.customer.points > 0 && me.loyalty.point_value > 0
      ? { available: cart.customer.points, value: me.loyalty.point_value }
      : null;

  const cartPanel = (
    <>
      <div className="flex items-center gap-2 border-b p-3">
        <Button variant="outline" className="min-w-0 flex-1 justify-start" onClick={() => setPicking(true)}>
          <UserRound />
          <span className="truncate">{cart.customer ? cart.customer.name : "Walk-in customer"}</span>
          <span className="ml-auto flex items-center gap-1">
            {cart.customer && cart.customer.points > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {fmtQty(cart.customer.points)} pts
              </Badge>
            )}
            {customerDiscount > 0 && <Badge variant="secondary">−{customerDiscount}%</Badge>}
          </span>
        </Button>
        {cart.customer && (
          <Button variant="ghost" size="icon" aria-label="Back to walk-in" onClick={() => setCart({ ...cart, customer: null })}>
            <X />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {cart.lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-sm text-muted-foreground">
            Scan or tap products to add them.
            {heldCount > 0 && (
              <Button variant="link" onClick={() => setHolding(true)}>
                {heldCount} cart(s) on hold (F7)
              </Button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {cart.lines.map((cl) => {
              const priced = totals.lines.filter((l) => l.productId === cl.productId);
              const paid = priced.find((l) => !l.free);
              const free = priced.find((l) => l.free);
              const lineTotal = priced.reduce((s, l) => s + l.total, 0);
              const overCap = cl.discountPct !== null && paid?.manual && cl.discountPct > Math.max(maxDiscount, customerDiscount);
              return (
                <li key={cl.productId} className="rounded-lg bg-background p-2 ring-1 ring-foreground/5">
                  <div className="flex items-start justify-between gap-2">
                    <ProductImage category={byId.get(cl.productId)?.category ?? cl.category} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{cl.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {paid && paid.unitPrice < cl.price ? (
                          <>
                            <s>{money(cl.price)}</s> {money(paid.unitPrice)}
                          </>
                        ) : (
                          money(cl.price)
                        )}{" "}
                        / {cl.unit}
                      </div>
                      {(paid?.promo || free) && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {paid?.promo && (
                            <Badge variant="secondary" className="h-5 gap-1 text-[11px]">
                              <Tag className="size-3" />
                              {paid.promo}
                              {paid.discount ? ` −${paid.discount}%` : ""}
                            </Badge>
                          )}
                          {free && (
                            <Badge className="h-5 gap-1 bg-emerald-600 text-[11px] text-white">
                              <Tag className="size-3" />
                              {fmtQty(free.qty)} free · {free.promo}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums">{money(lineTotal)}</div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <Button variant="outline" size="icon-sm" aria-label="One less" onClick={() => setQty(cl.productId, cl.qty - 1)}>
                      <Minus />
                    </Button>
                    <input
                      aria-label="Quantity"
                      inputMode="numeric"
                      className="h-7 w-11 rounded-md border bg-transparent text-center text-sm tabular-nums"
                      value={cl.qty}
                      onChange={(e) => setQty(cl.productId, Number(e.target.value.replace(/\D/g, "")) || 0)}
                    />
                    <Button variant="outline" size="icon-sm" aria-label="One more" onClick={() => setQty(cl.productId, cl.qty + 1)}>
                      <Plus />
                    </Button>
                    <label
                      className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
                      title={`Up to ${maxDiscount}% on your own; more needs a supervisor`}
                    >
                      Disc.
                      <input
                        inputMode="numeric"
                        className={cn(
                          "h-7 w-11 rounded-md border bg-transparent text-center text-sm tabular-nums",
                          overCap && "border-amber-500 text-amber-700 dark:text-amber-400",
                        )}
                        placeholder={String(customerDiscount)}
                        value={cl.discountPct ?? ""}
                        onChange={(e) => setDiscount(cl.productId, e.target.value)}
                      />
                      %
                    </label>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setQty(cl.productId, 0)}>
                      <Trash2 />
                    </Button>
                  </div>
                  {overCap && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Over {maxDiscount}%: a supervisor approves at payment.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t bg-background p-3">
        <InputGroup className="mb-2 h-8">
          <InputGroupAddon>
            <Tag />
          </InputGroupAddon>
          <InputGroupInput
            ref={voucherRef}
            aria-label="Voucher code"
            placeholder="Voucher code (F8)"
            className="font-mono uppercase"
            value={cart.voucher}
            onChange={(e) => setCart({ ...cart, voucher: e.target.value.toUpperCase() })}
            onKeyDown={(e) => e.key === "Enter" && searchRef.current?.focus()}
          />
          {cart.voucher && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Remove voucher" onClick={() => setCart({ ...cart, voucher: "" })}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {cart.voucher && cart.lines.length > 0 && (
          <p className={cn("mb-2 text-xs", totals.voucherError ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
            {totals.voucherError ?? `${totals.voucher?.name}: ${totals.voucher?.value}% off where it beats other prices.`}
          </p>
        )}
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{money(totals.gross)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <dt>Discount</dt>
              <dd className="tabular-nums">−{money(totals.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <dt>PPN {me.company.tax_rate}%</dt>
            <dd className="tabular-nums">{money(totals.tax)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-xl font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(totals.total)}</dd>
          </div>
        </dl>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="lg" className="h-12" disabled={!cart.lines.length} onClick={clearCart}>
            Clear
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12"
                  aria-label="Put on hold"
                  disabled={!cart.lines.length || hold.isPending}
                  onClick={() => hold.mutate()}
                />
              }
            >
              {hold.isPending ? <Spinner /> : <PauseCircle />}
            </TooltipTrigger>
            <TooltipContent>Put on hold (F6)</TooltipContent>
          </Tooltip>
          <Button size="lg" className="h-12 flex-1 text-base" disabled={!cart.lines.length || !me.erp_ready} onClick={pay}>
            Pay {cart.lines.length ? money(totals.total) : ""} <kbd className="ml-1 text-xs opacity-60">F9</kbd>
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---------------------------------------------------------------- catalogue */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
        {!me.erp_ready && (
          <Alert variant="destructive">
            <AlertTitle>Selling is paused</AlertTitle>
            <AlertDescription>
              The ERP has not confirmed it can take paid till sales yet. Press Stock to check again; if this
              stays, the ERP needs updating.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <InputGroup className="h-10">
            <InputGroupAddon>
              <ScanBarcode />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              autoFocus
              placeholder="Scan a barcode or search name, SKU, brand (F2)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setSearch("")}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => refreshStock.mutate()}
            disabled={refreshStock.isPending}
            title="Pull this store's stock and the promotions from the ERP"
          >
            {refreshStock.isPending ? <Spinner /> : <RefreshCw />}
            <span className="hidden sm:inline">Stock</span>
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setLowStock(true)} title="Products running out; ask the ERP for more">
            <TriangleAlert className={lowCount ? "text-amber-600 dark:text-amber-400" : undefined} />
            <span className="hidden xl:inline">Low stock</span>
            {lowCount > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {lowCount}
              </Badge>
            )}
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setHolding(true)} title="Carts on hold (F7)">
            <PauseCircle />
            {heldCount > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {heldCount}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="icon" className="hidden size-10 md:inline-flex" onClick={openDisplay} title="Open the customer display">
            <MonitorSmartphone />
          </Button>
          <Button variant="outline" size="icon" className="hidden size-10 md:inline-flex" onClick={() => setHelp(true)} title="Keyboard shortcuts (F1)">
            <Keyboard />
          </Button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Button size="sm" variant={category === null ? "default" : "outline"} onClick={() => setCategory(null)}>
            All
          </Button>
          {catalog.data?.categories.map((c) => (
            <Button key={c} size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
              {c}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {catalog.isPending ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageSearch />
                </EmptyMedia>
                <EmptyTitle>{products.length ? "No product matches" : "No products yet"}</EmptyTitle>
                <EmptyDescription>
                  {products.length ? "Try another word, or clear the category." : "Products arrive with the first ERP sync."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {visible.map((p) => {
                const left = p.available - inCart(p.id);
                const promo = promoFor.get(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={left <= 0}
                    onClick={() => add(p)}
                    className="flex min-h-28 flex-col justify-between gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ProductImage category={p.category} size="lg" />
                    <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                    {promo && (
                      <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        <Tag className="size-3 shrink-0" />
                        <span className="truncate">{promo}</span>
                      </span>
                    )}
                    <span className="flex items-end justify-between gap-2">
                      <span>
                        <span className="block font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                        <span className="font-semibold tabular-nums">{money(p.price)}</span>
                      </span>
                      <Badge
                        variant={left <= 0 ? "destructive" : left <= me.low_stock_at ? "secondary" : "outline"}
                        className="tabular-nums"
                      >
                        {left <= 0 ? "Out" : fmtQty(left)}
                      </Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <p className="hidden text-xs text-muted-foreground lg:block">
          Prices exclude PPN {me.company.tax_rate}%. Stock is the ERP&apos;s at the last sync, less sales not booked there yet.
          Press F1 for shortcuts.
        </p>
        {/* The cart lives in a drawer: the products keep the whole width. */}
        <div className="flex gap-2 border-t pt-3">
          <Button variant="outline" size="lg" className="h-12 min-w-0 flex-1 justify-between" onClick={() => setDrawer(true)}>
            <span className="flex items-center gap-2">
              <ShoppingCart />
              Cart
              <Badge variant={itemCount ? "default" : "secondary"} className="tabular-nums">
                {fmtQty(itemCount)}
              </Badge>
              {cart.customer && <span className="hidden truncate text-muted-foreground sm:inline">· {cart.customer.name}</span>}
              <kbd className="hidden text-xs opacity-60 md:inline">F3</kbd>
            </span>
            <span className="truncate font-semibold tabular-nums">{money(totals.total)}</span>
          </Button>
          <Button variant="outline" size="lg" className="h-12" aria-label="Put on hold (F6)" title="Put on hold (F6)"
            disabled={!cart.lines.length || hold.isPending} onClick={() => hold.mutate()}>
            {hold.isPending ? <Spinner /> : <PauseCircle />}
          </Button>
          <Button size="lg" className="h-12 px-6 text-base" disabled={!cart.lines.length || !me.erp_ready} onClick={pay}>
            Pay <kbd className="ml-1 hidden text-xs opacity-60 md:inline">F9</kbd>
          </Button>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cart drawer */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b bg-background">
            <SheetTitle>Cart · {fmtQty(itemCount)} item(s)</SheetTitle>
          </SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      <CustomerPicker open={picking} onOpenChange={setPicking} onPick={pickCustomer} />
      <PaymentDialog
        open={paying}
        onOpenChange={setPaying}
        total={totals.total}
        busy={checkout.isPending}
        wallet={wallet}
        defaultMethod={me.preferences.default_payment}
        onPay={(rows) => checkout.mutate(rows)}
      />
      <HeldCartsSheet open={holding} onOpenChange={setHolding} onResume={resume} cartBusy={cart.lines.length > 0} />
      <LowStockSheet open={lowStock} onOpenChange={setLowStock} products={products} threshold={me.low_stock_at} />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      <ReceiptDialog
        sale={receipt?.sale ?? null}
        offline={receipt?.offline ?? false}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}
