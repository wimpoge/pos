"""Receipts by email, for customers who'd rather not have paper."""

import smtplib
from email.message import EmailMessage
from html import escape

from ..models import Sale
from .common import DomainError, all_settings, rupiah

METHOD_LABEL = {"cash": "Cash", "card": "Card", "qris": "QRIS", "points": "Points"}


def receipt_lines(sale: Sale, footer: str) -> list[tuple[str, str]]:
    """The receipt as (left, right) rows, as printed."""
    rows: list[tuple[str, str]] = [(sale.number, sale.created_at.strftime("%d %b %Y %H:%M UTC")),
                                   ("Cashier", sale.cashier.full_name), ("Customer", sale.customer.name), ("", "")]
    for li in sale.lines:
        extra = f" -{li.discount_pct}%" if li.discount_pct else ""
        rows.append((f"{li.name}", ""))
        rows.append((f"  {li.qty} x {li.unit_price:,}{extra}" + (f" ({li.promo})" if li.promo else ""),
                     f"{li.line_total:,}"))
    rows.append(("", ""))
    if sale.gross != sale.subtotal:
        rows.append(("Discount", f"-{sale.gross - sale.subtotal:,}"))
    rows += [("Subtotal", f"{sale.subtotal:,}"), (f"PPN {sale.tax_rate}%", f"{sale.tax:,}"),
             ("TOTAL", rupiah(sale.total))]
    for p in sale.payments:
        rows.append((METHOD_LABEL.get(p.method, p.method), f"{(sale.cash_tendered if p.method == 'cash' else p.amount):,}"))
    if sale.change_due:
        rows.append(("Change", f"{sale.change_due:,}"))
    if sale.points_earned:
        rows.append(("Points earned", str(sale.points_earned)))
    if footer:
        rows += [("", ""), (footer, "")]
    return [(left.replace(",", "."), right.replace(",", ".")) for left, right in rows]


def send_receipt(db, settings, sale: Sale, to: str) -> None:
    if not settings.smtp_host:
        raise DomainError(503, "Email receipts are not set up on this POS (POS_SMTP_HOST).")
    company = all_settings(db)["erp.company_name"] or "Our store"
    rows = receipt_lines(sale, settings.receipt_footer)
    text = "\n".join(f"{left:<32} {right:>12}".rstrip() for left, right in rows)
    html_rows = "".join(f"<tr><td>{escape(left)}</td><td style='text-align:right'>{escape(right)}</td></tr>"
                        for left, right in rows)
    msg = EmailMessage()
    msg["Subject"] = f"Your receipt from {company}: {sale.number}"
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.set_content(f"{company} - {sale.store.name}\n\n{text}\n")
    msg.add_alternative(f"<div style='font-family:monospace;max-width:420px'><h3>{escape(company)}</h3>"
                        f"<p>{escape(sale.store.name)}</p><table style='width:100%'>{html_rows}</table></div>",
                        subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        raise DomainError(502, f"The receipt could not be sent ({type(e).__name__}). Print it instead.") from None
