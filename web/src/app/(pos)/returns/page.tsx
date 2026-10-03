"use client";

import { useMutation } from "@tanstack/react-query";
import { RotateCcw, Search } from "lucide-react";
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
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Returns" description={`Goods coming back to ${me.shift.store.name}, from any till of the store.`} />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Find the sale</CardTitle>
          <CardDescription>
            Scan or type the receipt number (e.g. {me.shift.store.code}/2026/00042, or just 42), or the ERP order number.
            Sales up to {me.return_days} days old can come back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex gap-2">
            <InputGroup className="h-10">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput autoFocus placeholder="Receipt number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </InputGroup>
            <Button type="submit" className="h-10" disabled={!number.trim() || find.isPending}>
              {find.isPending && <Spinner />} Find
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            To cancel a sale from this shift entirely, open it in{" "}
            <Link href="/sales" className="underline underline-offset-4">
              Sales
            </Link>{" "}
            and press Void.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
