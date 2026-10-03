"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CloudUpload, Receipt as ReceiptIcon, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, StatCard, StatusBadge } from "@/components/pos/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { get, post, type Page } from "@/lib/api";
import { dateTimeLabel, money, todayIso } from "@/lib/format";
import { METHOD_LABEL, type SaleRow, type SalesSummary } from "@/lib/types";

export default function SalesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [onlyToday, setOnlyToday] = useState(true);
  const [page, setPage] = useState(1);

  const summary = useQuery({ queryKey: ["sales-summary"], queryFn: () => get<SalesSummary>("/api/sales/summary") });
  const sales = useQuery({
    queryKey: ["sales", status, q, onlyToday, page],
    queryFn: () =>
      get<Page<SaleRow>>("/api/sales", {
        erp_status: status === "all" ? undefined : status,
        q,
        on: onlyToday && status === "all" ? todayIso() : undefined,
        page,
        page_size: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const retry = useMutation({
    mutationFn: () => post<{ synced: number; pending: number; failed: number }>("/api/sales/push-pending", undefined),
    onSuccess: (r) => {
      toast.info(`${r.synced} sent to the ERP, ${r.pending} still waiting, ${r.failed} refused.`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
    },
  });

  const s = summary.data;
  const pages = sales.data ? Math.max(1, Math.ceil(sales.data.total / sales.data.page_size)) : 1;
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Sales"
        description="Your sales, and whether the ERP has booked them."
        actions={
          (s?.erp.pending ?? 0) > 0 && (
            <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? <Spinner /> : <CloudUpload />} Send waiting sales
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Takings today" icon={<Banknote />} value={money(s?.net)} hint={s && (s.refunds ? `${money(s.refunds)} refunded` : `incl. PPN ${money(s.tax)}`)} />
        <StatCard label="Sales today" icon={<ReceiptIcon />} value={s?.sales_count ?? "—"} hint={s && `average ${money(s.average)}`} />
        <StatCard
          label="By method"
          icon={<ShoppingBag />}
          value={<span className="text-base">{s ? `${money(s.by_method.cash)} cash` : "—"}</span>}
          hint={s && `${money(s.by_method.card)} card · ${money(s.by_method.qris)} QRIS`}
        />
        <StatCard
          label="ERP"
          icon={<CloudUpload />}
          value={s ? (s.erp.pending + s.erp.failed === 0 ? "All booked" : `${s.erp.pending + s.erp.failed} open`) : "—"}
          tone={s?.erp.failed ? "danger" : s?.erp.pending ? undefined : "success"}
          hint={s && (s.erp.failed ? `${s.erp.failed} refused, retried every 10 min` : s.erp.pending ? `${s.erp.pending} waiting, retrying` : "Every sale is in the ERP")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onValueChange={(v) => { setStatus(String(v)); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Waiting</TabsTrigger>
            <TabsTrigger value="failed">Refused</TabsTrigger>
            <TabsTrigger value="synced">In ERP</TabsTrigger>
            <TabsTrigger value="voided">Voided</TabsTrigger>
          </TabsList>
        </Tabs>
        {status === "all" && (
          <Button variant={onlyToday ? "secondary" : "ghost"} size="sm" onClick={() => { setOnlyToday(!onlyToday); setPage(1); }}>
            {onlyToday ? "Today" : "All days"}
          </Button>
        )}
        <InputGroup className="ml-auto w-full sm:w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Receipt, SO number, customer" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </InputGroup>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="hidden md:table-cell">Customer</TableHead>
              <TableHead className="hidden sm:table-cell">Paid by</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>ERP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.data?.items.map((sale) => (
              <TableRow key={sale.id} className="cursor-pointer" onClick={() => router.push(`/sales/${sale.id}`)}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/sales/${sale.id}`} onClick={(e) => e.stopPropagation()}>
                    {sale.number}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{dateTimeLabel(sale.created_at)}</TableCell>
                <TableCell className="hidden max-w-48 truncate md:table-cell">{sale.customer.name}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {sale.methods.map((m) => METHOD_LABEL[m]).join(" + ")}
                  {sale.offline && " · offline"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  <span className={sale.voided ? "text-muted-foreground line-through" : undefined}>{money(sale.total)}</span>
                  {sale.refunded > 0 && !sale.voided && <span className="block text-xs font-normal text-destructive">−{money(sale.refunded)} back</span>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={sale.erp.status} />
                    {sale.erp.order_number && <span className="hidden font-mono text-xs text-muted-foreground xl:inline">{sale.erp.order_number}</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sales.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No sales here.
                </TableCell>
              </TableRow>
            )}
            {sales.isPending && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          Page {page} of {pages}
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
