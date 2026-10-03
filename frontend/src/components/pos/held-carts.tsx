"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { del, get, post } from "@/lib/api";
import { relative } from "@/lib/format";
import type { HeldCart } from "@/lib/types";

export function useHeldCarts() {
  return useQuery({ queryKey: ["held-carts"], queryFn: () => get<HeldCart[]>("/api/held-carts"), refetchInterval: 30_000 });
}

/** Carts on hold in this store; resuming one brings it back to the till (and off the list). */
export function HeldCartsSheet({
  open,
  onOpenChange,
  onResume,
  cartBusy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResume: (cart: HeldCart) => void;
  /** The till already has items: resuming would mix two customers. */
  cartBusy: boolean;
}) {
  const queryClient = useQueryClient();
  const held = useHeldCarts();
  const resume = useMutation({
    mutationFn: (id: number) => post<HeldCart>(`/api/held-carts/${id}/resume`),
    onSuccess: (cart) => {
      queryClient.invalidateQueries({ queryKey: ["held-carts"] });
      onResume(cart);
      onOpenChange(false);
    },
  });
  const discard = useMutation({
    mutationFn: (id: number) => del(`/api/held-carts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["held-carts"] }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Carts on hold</SheetTitle>
          <SheetDescription>
            {cartBusy ? "Finish or hold the current cart first, then resume one of these." : "Any cashier of this store can pick one up."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {held.isPending && <Spinner className="mx-auto my-6" />}
          {held.data?.length === 0 && (
            <p className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <PauseCircle className="size-6" /> Nothing on hold. Press F6 at the till to put a cart aside.
            </p>
          )}
          {held.data?.map((h) => (
            <div key={h.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.note || h.customer?.name || "Walk-in customer"}</div>
                <div className="text-xs text-muted-foreground">
                  {h.items} item(s) · {h.user} · {relative(h.created_at)}
                  {h.voucher_code && ` · ${h.voucher_code}`}
                </div>
              </div>
              <Button size="sm" disabled={cartBusy || resume.isPending} onClick={() => resume.mutate(h.id)}>
                <Play /> Resume
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Discard" disabled={discard.isPending} onClick={() => discard.mutate(h.id)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
