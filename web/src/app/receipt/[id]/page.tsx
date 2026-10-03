"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Receipt } from "@/components/pos/receipt";
import { Spinner } from "@/components/ui/spinner";
import { get } from "@/lib/api";
import { AuthProvider, useMe } from "@/lib/auth";
import type { Sale } from "@/lib/types";

/** Just the receipt, for the receipt printer: opened in a small window from the till. */
export default function ReceiptPage() {
  return (
    <AuthProvider fallback={<Spinner className="m-8" />}>
      <PrintableReceipt />
    </AuthProvider>
  );
}

function PrintableReceipt() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const sale = useQuery({ queryKey: ["sales", "detail", id], queryFn: () => get<Sale>(`/api/sales/${id}`) });

  useEffect(() => {
    if (sale.data && new URLSearchParams(window.location.search).get("print")) {
      const t = setTimeout(() => window.print(), 300); // let fonts settle
      return () => clearTimeout(t);
    }
  }, [sale.data]);

  if (!sale.data) return <Spinner className="m-8" />;
  return (
    <div className="min-h-svh bg-white">
      <style>{`@page { size: 80mm auto; margin: 0; } @media print { .receipt { max-width: none; } }`}</style>
      <Receipt sale={sale.data} company={me.company} copy={new URLSearchParams(window.location.search).has("copy")} />
    </div>
  );
}
