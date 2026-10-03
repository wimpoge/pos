const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const compactIdr = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("id-ID");

export const money = (n: number | null | undefined) => (n == null ? "—" : idr.format(n));
/** Rp 1.2B, Rp 350M: for chart axes and stat tiles where space is tight. */
export const moneyShort = (n: number) => `Rp ${compactIdr.format(n)}`;
export const qty = (n: number | null | undefined) => (n == null ? "—" : num.format(n));
export const pct = (n: number) => `${n}%`;

// The API sends dates as YYYY-MM-DD and timestamps as naive UTC.
const parse = (v: string) => (v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v.endsWith("Z") ? v : `${v}Z`));
export const dateLabel = (v: string | null | undefined) =>
  v ? parse(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const dateTimeLabel = (v: string | null | undefined) =>
  v ? parse(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
/** 17:00 in the viewer's clock (the till's own, in the shop). */
export const timeLabel = (v: string | null | undefined) =>
  v ? parse(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";
export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const relative = (v: string) => {
  const diff = (Date.now() - parse(v).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return dateLabel(v);
};
