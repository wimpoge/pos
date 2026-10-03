"use client";

import { useMutation } from "@tanstack/react-query";
import { CloudOff, Mail, Printer } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Receipt } from "@/components/pos/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { money } from "@/lib/format";
import type { Sale } from "@/lib/types";

export function printReceipt(saleId: number, copy = false) {
  window.open(`/receipt/${saleId}?print=1${copy ? "&copy=1" : ""}`, "_blank", "width=420,height=700");
}

/** Email a receipt: the customer's address is filled in when the ERP has one. */
export function EmailReceiptButton({ sale, size = "default" }: { sale: Sale; size?: "default" | "sm" }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(sale.customer_email ?? "");
  const send = useMutation({
    mutationFn: () => post(`/api/sales/${sale.id}/email`, { to }),
    onSuccess: () => {
      toast.success(`Receipt sent to ${to}.`);
      setOpen(false);
    },
  });
  if (!me.email_receipts) return null;
  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size={size} />}>
        <Mail /> Email
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={`email-${sale.id}`} className="text-sm font-medium">
            Send the receipt to
          </label>
          <Input id={`email-${sale.id}`} type="email" required autoFocus value={to} onChange={(e) => setTo(e.target.value)} />
          <Button type="submit" disabled={send.isPending}>
            {send.isPending && <Spinner />} Send
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** After payment: change to give, the receipt, print or email it. An offline sale prints later. */
export function ReceiptDialog({ sale, offline, onClose }: { sale: Sale | null; offline: boolean; onClose: () => void }) {
  const me = useMe();
  return (
    <Dialog open={sale !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {offline ? "Sale saved on this till" : "Sale complete"}
            {sale && sale.change_due > 0 && (
              <span className="mt-1 block text-2xl text-emerald-700 tabular-nums dark:text-emerald-400">
                Change {money(sale.change_due)}
              </span>
            )}
          </DialogTitle>
          {offline && (
            <DialogDescription className="flex items-start gap-2">
              <CloudOff className="mt-0.5 size-4 shrink-0" />
              The POS server can&apos;t be reached. The sale is kept here and sent by itself when it is back; print the
              receipt from Sales then.
            </DialogDescription>
          )}
        </DialogHeader>
        {sale && (
          <div className="rounded-lg border">
            <Receipt sale={sale} company={me.company} />
          </div>
        )}
        <DialogFooter>
          {sale && !offline && (
            <>
              <EmailReceiptButton sale={sale} />
              <Button variant="outline" onClick={() => printReceipt(sale.id)}>
                <Printer /> Print
              </Button>
            </>
          )}
          <Button autoFocus onClick={onClose}>
            New sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
