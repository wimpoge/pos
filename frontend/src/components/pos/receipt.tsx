import { dateTimeLabel, money } from "@/lib/format";
import { METHOD_LABEL, type Sale } from "@/lib/types";
import type { Me } from "@/lib/auth";

/** A till receipt, sized for an 80 mm thermal printer and readable on screen. A reprint says COPY. */
export function Receipt({ sale, company, copy = false }: { sale: Sale; company: Me["company"]; copy?: boolean }) {
  const n = (v: number) => v.toLocaleString("id-ID");
  return (
    <div className="receipt mx-auto w-full max-w-[19rem] bg-white p-4 font-mono text-[11px] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{company.name || "Store"}</div>
        <div>{sale.store.name}</div>
        {company.address && <div>{company.address}</div>}
        {company.phone && <div>Tel. {company.phone}</div>}
        {company.tax_id && <div>NPWP {company.tax_id}</div>}
      </div>
      {(copy || sale.voided) && (
        <div className="mt-2 border border-black py-0.5 text-center text-xs font-bold tracking-widest">
          {sale.voided ? "VOID" : "COPY"}
        </div>
      )}
      <Rule />
      <Row left={sale.number} right={dateTimeLabel(sale.created_at)} />
      <Row left="Cashier" right={sale.cashier.full_name} />
      <Row left="Customer" right={sale.customer.name} />
      <Rule />
      {sale.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div className="break-words">{l.name}</div>
          <Row
            left={`  ${l.qty} x ${n(l.unit_price)}${l.discount_pct === 100 ? " FREE" : l.discount_pct ? ` -${l.discount_pct}%` : ""}`}
            right={n(l.line_total)}
          />
          {l.promo && <div className="pl-2 text-[10px]">* {l.promo}</div>}
        </div>
      ))}
      <Rule />
      {sale.discount > 0 && <Row left="Discount" right={`-${n(sale.discount)}`} />}
      {sale.voucher_code && <Row left="Voucher" right={sale.voucher_code} />}
      <Row left="Subtotal" right={n(sale.subtotal)} />
      <Row left={`PPN ${sale.tax_rate}%`} right={n(sale.tax)} />
      <div className="my-1 flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{money(sale.total)}</span>
      </div>
      <Rule />
      {sale.payments.map((p, i) => (
        <Row
          key={i}
          left={`${METHOD_LABEL[p.method]}${p.reference ? ` (${p.reference})` : ""}`}
          right={n(p.method === "cash" ? sale.cash_tendered : p.amount)}
        />
      ))}
      {sale.change_due > 0 && <Row left="Change" right={n(sale.change_due)} />}
      {sale.refunded > 0 && <Row left="Refunded" right={`-${n(sale.refunded)}`} />}
      {(sale.points_earned > 0 || sale.points_redeemed > 0) && (
        <>
          <Rule />
          {sale.points_redeemed > 0 && <Row left="Points spent" right={n(sale.points_redeemed)} />}
          {sale.points_earned > 0 && <Row left="Points earned" right={n(sale.points_earned)} />}
        </>
      )}
      <Rule />
      <div className="text-center">
        <div>{sale.items} item(s)</div>
        {company.receipt_footer && <div className="mt-1">{company.receipt_footer}</div>}
        {sale.erp.order_number && <div className="mt-1 text-[10px]">ERP {sale.erp.order_number}</div>}
        {sale.offline && <div className="mt-1 text-[10px]">Rung up offline</div>}
      </div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="min-w-0 break-words">{left}</span>
      <span className="shrink-0 text-right">{right}</span>
    </div>
  );
}

const Rule = () => <div className="my-1.5 border-t border-dashed border-black" />;
