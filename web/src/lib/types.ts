export type Store = { id: number; code: string; name: string; city: string | null; active: boolean };

export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  barcode: string | null;
  unit: string;
  price: number;
  category: string | null;
  brand: string | null;
  available: number;
};

export type Promotion = {
  id: number;
  name: string;
  kind: "percent" | "price" | "buy_get" | "voucher";
  value: number;
  buy_qty: number;
  get_qty: number;
  code: string | null;
  min_spend: number;
  starts_on: string | null;
  ends_on: string | null;
  product_id: number | null;
  category: string | null;
  store_id: number | null;
};

export type Catalog = { store: Store; products: CatalogProduct[]; categories: string[]; promotions: Promotion[] };

export type Customer = {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  group: string | null;
  discount_pct: number;
  /** Loyalty points this customer can spend now. */
  points: number;
};

export type PaymentMethod = "cash" | "card" | "qris" | "points";

export type ErpState = {
  status: "pending" | "synced" | "failed" | "voided";
  order_number: string | null;
  invoice_number: string | null;
  error: string | null;
  attempts: number;
  last_attempt_at: string | null;
  synced_at: string | null;
};

export type SaleRow = {
  id: number;
  number: string;
  created_at: string;
  business_date: string;
  store: { id: number; code: string; name: string };
  cashier: { id: number; full_name: string };
  customer: { id: number; code: string; name: string };
  total: number;
  items: number;
  methods: PaymentMethod[];
  /** Refunded so far by returns and voids. */
  refunded: number;
  voided: boolean;
  offline: boolean;
  erp: ErpState;
};

export type SaleReturn = {
  id: number;
  number: string;
  kind: "return" | "void";
  created_at: string;
  reason: string;
  approved_by: string;
  cashier: string;
  subtotal: number;
  tax: number;
  total: number;
  sale: { id: number; number: string };
  lines: { sale_line_id: number; sku: string; name: string; qty: number; line_total: number }[];
  refunds: { method: PaymentMethod; amount: number; reference: string | null }[];
  erp: {
    status: "pending" | "synced" | "failed" | "skipped";
    return_number: string | null;
    error: string | null;
    attempts: number;
    last_attempt_at: string | null;
    synced_at: string | null;
  };
};

export type Sale = SaleRow & {
  shift: { id: number; number: string };
  tax_rate: number;
  gross: number;
  discount: number;
  subtotal: number;
  tax: number;
  cash_tendered: number;
  change_due: number;
  note: string | null;
  external_id: string;
  voucher_code: string | null;
  approved_by: string | null;
  points_earned: number;
  points_redeemed: number;
  customer_email: string | null;
  voided_at: string | null;
  lines: {
    id: number;
    product_id: number;
    sku: string;
    name: string;
    qty: number;
    unit_price: number;
    discount_pct: number;
    line_total: number;
    promo: string | null;
    /** Units of this line that came back already. */
    returned: number;
  }[];
  payments: { method: PaymentMethod; amount: number; reference: string | null }[];
  returns: SaleReturn[];
};

export type SalesSummary = {
  date: string;
  sales_count: number;
  total: number;
  tax: number;
  items: number;
  average: number;
  refunds: number;
  net: number;
  /** Net of refunds. */
  by_method: Record<PaymentMethod, number>;
  top_products: { name: string; qty: number; total: number }[];
  erp: { pending: number; failed: number };
};

export type Shift = {
  id: number;
  number: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  store: { id: number; code: string; name: string };
  cashier: { id: number; full_name: string };
  opening_float: number;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  closing_note: string | null;
  /** Ended by the clock at closing time, not by the cashier. */
  auto_closed: boolean;
  /** Ended at closing time and the drawer still has to be counted. */
  needs_count: boolean;
};

export type ShiftDetail = Shift & {
  summary: {
    sales_count: number;
    sales_total: number;
    refunds_count: number;
    refunds_total: number;
    net_total: number;
    /** Net of refunds made in this shift. */
    by_method: Record<PaymentMethod, number>;
    cash_in: number;
    cash_out: number;
    expected_cash: number;
  };
  movements: { id: number; kind: "in" | "out"; amount: number; reason: string; at: string; user: string; approved_by: string | null }[];
  closed_by: string | null;
};

export type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  scope: string;
  status: "running" | "ok" | "partial" | "failed";
  stats: Record<string, Record<string, number | string | boolean>>;
  errors: string[];
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", qris: "QRIS", points: "Points" };

export type HeldCart = {
  id: number;
  created_at: string;
  user: string;
  note: string | null;
  lines: { product_id: number; qty: number; discount_pct: number | null }[];
  voucher_code: string | null;
  items: number;
  customer: Customer | null;
};

export type StockRequest = {
  id: number;
  created_at: string;
  user: string;
  lines: { product_id: number; sku: string; name: string; qty: number }[];
  note: string | null;
  erp_transfer_number: string;
  source: string;
};

export type DayReport = {
  store: { id: number; code: string; name: string };
  date: string;
  sales: { count: number; voided: number; offline: number; items: number; gross: number; discount: number; subtotal: number; tax: number; total: number };
  returns: { count: number; voids: number; subtotal: number; tax: number; total: number };
  net: { total: number; subtotal: number; tax: number };
  by_method: { method: PaymentMethod; taken: number; refunded: number; net: number }[];
  cash: { in: number; out: number };
  points: { earned: number; redeemed: number };
  shifts: {
    id: number;
    number: string;
    cashier: string;
    status: "open" | "closed";
    opened_at: string;
    closed_at: string | null;
    opening_float: number;
    expected_cash: number | null;
    counted_cash: number | null;
    variance: number | null;
    auto_closed: boolean;
  }[];
  by_cashier: { name: string; sales: number; total: number; refunds: number }[];
  top_products: { sku: string; name: string; qty: number; total: number }[];
  promotions: { name: string; lines: number; discount: number }[];
  erp: { waiting: number; refused: number };
};
