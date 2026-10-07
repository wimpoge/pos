"use client";

import { useMutation } from "@tanstack/react-query";
import { Info, RotateCcw, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { PageHeader } from "@/components/pos/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { get } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { Sale } from "@/lib/types";

/** A customer is back with a receipt: find the sale, then take the goods back from it. */
export default function ReturnsPage() {
  const me = useMe();
  const router = useRouter();
  const [number, setNumber] = useState("");
  const find = useMutation({
    mutationFn: () => get<Sale>("/api/sales/lookup", { number }),
    onSuccess: (sale) => router.push(`/sales/${sale.id}?return=1`),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (number.trim()) find.mutate();
  }

  if (!me.shift)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RotateCcw />
          </EmptyMedia>
          <EmptyTitle>Open a shift first</EmptyTitle>
          <EmptyDescription>Refunds come out of your drawer, so a return needs an open shift.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/" />} nativeButton={false}>
            Go to the till
          </Button>
        </EmptyContent>
      </Empty>
    );

  return (
    <div className="flex flex-col gap-6 p-4 md:px-6 md:pt-5">
      <PageHeader title="Returns" description={`Goods coming back to ${me.shift.store.name}, from any till of the store.`} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Find the sale</CardTitle>
            <CardDescription>
              Scan or type the receipt number (e.g. {me.shift.store.code}/2026/00042, or just 42), or the ERP order number.
              Sales up to {me.return_days} days old can come back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex gap-2">
              <InputGroup className="h-14 rounded-xl">
                <InputGroupAddon className="pl-4">
                  <ScanBarcode />
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus
                  className="text-base"
                  placeholder="Receipt or SO number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </InputGroup>
              <Button type="submit" size="lg" className="h-14 rounded-xl px-7 text-base font-bold" disabled={!number.trim() || find.isPending}>
                {find.isPending && <Spinner />} Find
              </Button>
            </form>
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-subtle px-4 py-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>
                To cancel a sale from this shift entirely, open it in{" "}
                <Link href="/sales" className="font-medium text-primary underline underline-offset-4">
                  Sales
                </Link>{" "}
                and press Void.
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How a return works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {[
                ["Find the sale", "By receipt or ERP order number."],
                ["Pick what comes back", "Items and quantities from that sale."],
                ["Refund and book", "The refund is recorded on this shift and sent to the ERP."],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                  <span>
                    <span className="block font-semibold">{title}</span>
                    <span className="block text-xs text-muted-foreground">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
