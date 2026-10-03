"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/pos/common";
import { DayReportView } from "@/components/pos/day-report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { get } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import type { DayReport, Store } from "@/lib/types";

/** The end-of-day (Z) report: one store, one day, every cashier. Prints on A4 or the receipt printer. */
export default function DayReportPage() {
  const me = useMe();
  const [on, setOn] = useState(todayIso());
  const [storeId, setStoreId] = useState<number | null>(me.shift?.store.id ?? null);
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => get<Store[]>("/api/stores") });
  const store = storeId ?? stores.data?.[0]?.id ?? null;
  const report = useQuery({
    queryKey: ["day-report", store, on],
    queryFn: () => get<DayReport>("/api/reports/day", { store_id: store, on }),
    enabled: store !== null,
  });
  const r = report.data;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 print:gap-3 print:p-0">
      <PageHeader
        title="Day report"
        description="Everything a store took and paid back on one day, across every till and shift."
        actions={
          <>
            <select
              aria-label="Store"
              className="h-9 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30"
              value={store ?? ""}
              onChange={(e) => setStoreId(Number(e.target.value))}
            >
              {stores.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Input type="date" aria-label="Day" className="h-9 w-40" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value || todayIso())} />
            <Button variant="outline" onClick={() => window.print()} disabled={!r}>
              <Printer /> Print
            </Button>
          </>
        }
      />
      <DayReportView report={r} />
    </div>
  );
}
