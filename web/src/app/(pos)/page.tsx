"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { EndShiftDialog } from "@/components/pos/end-shift-dialog";
import { Till } from "@/components/pos/till";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { Shift, Store, SyncRun } from "@/lib/types";

export default function TillPage() {
  const me = useMe();
  if (!me.shift) return me.after_hours ? <ClosedForToday /> : <OpenShift />;
  return <Till key={me.shift.id} storeId={me.shift.store.id} />;
}

/** After closing time: no selling until tomorrow. The cashier may still have a drawer to count. */
function ClosedForToday() {
  const me = useMe();
  const recent = useQuery({ queryKey: ["shift", "list"], queryFn: () => get<Shift[]>("/api/shifts", { limit: 5 }) });
  const uncounted = recent.data?.find((s) => s.needs_count);
  const [counting, setCounting] = useState(false);
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Moon />
        </EmptyMedia>
        <EmptyTitle>The till is closed for today</EmptyTitle>
        <EmptyDescription>
          Shifts end at {me.shift_end_time}. You can open a new one tomorrow.
          {uncounted && ` Your shift ${uncounted.number} ended by itself; count the drawer before you go.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {uncounted && <Button onClick={() => setCounting(true)}>Count the drawer</Button>}
        <Button variant="outline" render={<Link href="/sales" />} nativeButton={false}>
          Today&apos;s sales
        </Button>
      </EmptyContent>
      <EndShiftDialog shiftId={uncounted?.id ?? null} open={counting} onOpenChange={setCounting} />
    </Empty>
  );
}

function OpenShift() {
  const queryClient = useQueryClient();
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => get<Store[]>("/api/stores") });
  const load = useMutation({
    mutationFn: () => post<SyncRun>("/api/sync"),
    onSuccess: (run) => {
      if (run.errors.length) toast.error(run.errors.join("\n"));
      queryClient.invalidateQueries({ queryKey: ["stores"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const [storeId, setStoreId] = useState<string>("");
  const [float, setFloat] = useState("");
  const open = useMutation({
    mutationFn: () => post("/api/shifts", { store_id: Number(storeId), opening_float: Number(float.replace(/\D/g, "")) || 0 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    open.mutate();
  }

  if (stores.isPending)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading stores…
      </div>
    );

  if (!stores.data?.length)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <StoreIcon />
          </EmptyMedia>
          <EmptyTitle>No stores yet</EmptyTitle>
          <EmptyDescription>Stores, products and stock come from the ERP. They load when you log in.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => load.mutate()} disabled={load.isPending}>
            {load.isPending && <Spinner />} Load from the ERP
          </Button>
        </EmptyContent>
      </Empty>
    );

  const items = stores.data.map((s) => ({ value: String(s.id), label: `${s.name} (${s.code})` }));
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Open a shift</CardTitle>
          <CardDescription>Pick your store and count the cash in the drawer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel>Store</FieldLabel>
                <Select items={items} value={storeId || null} onValueChange={(v) => setStoreId(String(v ?? ""))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="float">Opening float (Rp)</FieldLabel>
                <Input
                  id="float"
                  inputMode="numeric"
                  placeholder="0"
                  value={float ? Number(float.replace(/\D/g, "")).toLocaleString("id-ID") : ""}
                  onChange={(e) => setFloat(e.target.value)}
                />
                <FieldDescription>The cash you start with, so the drawer can be checked at closing.</FieldDescription>
              </Field>
              <Button type="submit" disabled={!storeId || open.isPending}>
                {open.isPending && <Spinner />} Open shift
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
