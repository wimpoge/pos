"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, UserPlus, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { get, post } from "@/lib/api";
import type { Customer } from "@/lib/types";

export function CustomerPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (customer: Customer | null) => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const results = useQuery({
    queryKey: ["customers", q],
    queryFn: () => get<Customer[]>("/api/customers", { q, limit: 20 }),
    enabled: open && !creating,
  });

  function pick(c: Customer | null) {
    onPick(c);
    onOpenChange(false);
    setQ("");
    setCreating(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New customer" : "Customer"}</DialogTitle>
          <DialogDescription>
            {creating
              ? "Saved in the ERP, so they get a customer code there and can earn their group discount."
              : "Search by name, code, phone or email. Group discounts apply automatically."}
          </DialogDescription>
        </DialogHeader>
        {creating ? (
          <NewCustomerForm initialName={q} onCreated={pick} onCancel={() => setCreating(false)} />
        ) : (
          <div className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput autoFocus placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.isFetching && (
                <InputGroupAddon align="inline-end">
                  <Spinner />
                </InputGroupAddon>
              )}
            </InputGroup>
            <div className="-mx-1 flex max-h-80 flex-col overflow-y-auto">
              <button
                type="button"
                className="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                onClick={() => pick(null)}
              >
                <UserRound className="size-4 text-muted-foreground" />
                <span className="flex-1 font-medium">Walk-in customer</span>
                <span className="text-xs text-muted-foreground">no name needed</span>
              </button>
              {results.data?.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                  onClick={() => pick(c)}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{c.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  {c.points > 0 && (
                    <Badge variant="outline" className="tabular-nums">
                      {c.points.toLocaleString("id-ID")} pts
                    </Badge>
                  )}
                  {c.discount_pct > 0 && (
                    <Badge variant="secondary">
                      {c.group} −{c.discount_pct}%
                    </Badge>
                  )}
                </button>
              ))}
              {results.data?.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">No customer matches “{q}”.</p>
              )}
            </div>
            <Button variant="outline" onClick={() => setCreating(true)}>
              <UserPlus /> New customer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewCustomerForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (c: Customer) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(/\d/.test(initialName) ? "" : initialName);
  const [phone, setPhone] = useState(/\d/.test(initialName) ? initialName : "");
  const [email, setEmail] = useState("");
  const create = useMutation({
    mutationFn: () => post<Customer>("/api/customers", { name, phone: phone || null, email: email || null }),
    onSuccess: (c) => {
      toast.success(`${c.name} saved in the ERP as ${c.code}`);
      onCreated(c);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="c-name">Name</FieldLabel>
          <Input id="c-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="c-phone">Phone</FieldLabel>
            <Input id="c-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-email">Email</FieldLabel>
            <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Spinner />} Save customer
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
