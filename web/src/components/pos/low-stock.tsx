"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { get, post } from "@/lib/api";
import { relative, qty as fmtQty } from "@/lib/format";
import type { CatalogProduct, StockRequest } from "@/lib/types";

/** Products running out here, and asking the ERP to send more: it becomes a draft transfer there. */
export function LowStockSheet({
  open,
  onOpenChange,
  products,
  threshold,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: CatalogProduct[];
  threshold: number;
}) {
  const queryClient = useQueryClient();
  const low = products.filter((p) => p.available <= threshold).sort((a, b) => a.available - b.available || a.name.localeCompare(b.name));
  const [wanted, setWanted] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const requests = useQuery({ queryKey: ["stock-requests"], queryFn: () => get<StockRequest[]>("/api/stock-requests"), enabled: open });
  const lines = Object.entries(wanted)
    .map(([id, q]) => ({ product_id: Number(id), qty: Number(q.replace(/\D/g, "")) || 0 }))
    .filter((l) => l.qty > 0);
  const send = useMutation({
    mutationFn: () => post<StockRequest>("/api/stock-requests", { lines, note: note || null }),
    onSuccess: (r) => {
      toast.success(`Requested from ${r.source}: ERP transfer ${r.erp_transfer_number}, waiting for the warehouse.`);
      setWanted({});
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["stock-requests"] });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Low stock</SheetTitle>
          <SheetDescription>
            {threshold} or fewer left in this store. Enter how many you want and send the request to the ERP.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {low.length === 0 ? (
            <p className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <PackageCheck className="size-6" /> Everything is well stocked.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {low.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                  </div>
                  <Badge variant={p.available <= 0 ? "destructive" : "secondary"} className="tabular-nums">
                    {p.available <= 0 ? "Out" : `${fmtQty(p.available)} left`}
                  </Badge>
                  <Input
                    aria-label={`How many ${p.name}`}
                    inputMode="numeric"
                    placeholder="0"
                    className="h-8 w-16 text-center tabular-nums"
                    value={wanted[p.id] ?? ""}
                    onChange={(e) => setWanted({ ...wanted, [p.id]: e.target.value.replace(/\D/g, "") })}
                  />
                </li>
              ))}
            </ul>
          )}
          {low.length > 0 && (
            <div className="flex gap-2">
              <Input placeholder="Note for the warehouse (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={!lines.length || send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? <Spinner /> : <Send />} Request
              </Button>
            </div>
          )}
          {!!requests.data?.length && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Recent requests</h3>
              {requests.data.map((r) => (
                <div key={r.id} className="rounded-lg bg-muted/50 p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono">{r.erp_transfer_number}</span>
                    <span className="text-muted-foreground">
                      {relative(r.created_at)} · {r.user}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    from {r.source}: {r.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
