"use client";

import { ReactNode } from "react";
import { AppSidebar } from "@/components/pos/app-sidebar";
import { ApprovalProvider } from "@/components/pos/approval";
import { LockProvider } from "@/components/pos/lock";
import { Spinner } from "@/components/ui/spinner";
import { AuthProvider } from "@/lib/auth";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider
      fallback={
        <div className="flex h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      }
    >
      <ApprovalProvider>
        <LockProvider>
          <div data-slot="app-shell" className="flex h-svh bg-background print:block print:h-auto">
            <AppSidebar />
            {/* Each page has its own header (title on the left, status pills on the right). On a
                phone the rail is a bar along the bottom, so the page stops above it. */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-16 md:pb-0 print:overflow-visible print:pb-0">
              {children}
            </main>
          </div>
        </LockProvider>
      </ApprovalProvider>
    </AuthProvider>
  );
}
