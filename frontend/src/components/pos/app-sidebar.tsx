"use client";

import {
  ChartColumn,
  Clock,
  KeyRound,
  Lock,
  RotateCcw,
  LogOut,
  Monitor,
  Moon,
  ReceiptText,
  ShoppingCart,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EndShiftDialog } from "@/components/pos/end-shift-dialog";
import { useLock } from "@/components/pos/lock";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { forgetMe, useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = { title: string; href: string; icon: LucideIcon };

// A cashier's app: products, prices, customers and users are run in the ERP.
export const NAV: NavItem[] = [
  { title: "Till", href: "/", icon: ShoppingCart },
  { title: "Sales", href: "/sales", icon: ReceiptText },
  { title: "Returns", href: "/returns", icon: RotateCcw },
  { title: "Day report", href: "/report", icon: ChartColumn },
  { title: "Shift", href: "/shift", icon: Clock },
];

/** Down by the cashier's name, apart from the work pages. */
const PROFILE: NavItem = { title: "Profile", href: "/profile", icon: UserRound };

/** The nav item for a path: "/" only matches the till itself, "/sales/12" matches Sales. */
export function findNav(pathname: string): NavItem | undefined {
  return [...NAV, PROFILE].find((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)));
}

const RAIL_ITEM =
  "flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        RAIL_ITEM,
        "h-14 min-w-0 flex-1 md:h-[60px] md:w-[72px] md:flex-none",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-white",
      )}
    >
      <item.icon className="size-5" />
      {item.title === "Day report" ? "Report" : item.title}
    </Link>
  );
}

/** The navy rail: the work pages, then Profile and the cashier's menu at the bottom. On a phone
 * it is a bar along the bottom of the screen. */
export function AppSidebar() {
  const active = findNav(usePathname())?.href;
  return (
    <nav
      aria-label="Main"
      data-slot="rail"
      className={cn(
        "z-30 flex shrink-0 bg-sidebar print:hidden",
        // phone: a bar along the bottom
        "fixed inset-x-0 bottom-0 h-16 items-center justify-around border-t border-sidebar-border px-1",
        // tablet and up: the rail on the left
        "md:static md:h-svh md:w-[88px] md:flex-col md:justify-start md:gap-1.5 md:border-t-0 md:px-2 md:py-4",
      )}
    >
      <Link
        href="/"
        aria-label="POS"
        className="mb-4 hidden size-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm md:flex"
      >
        <ShoppingCart className="size-5" />
      </Link>
      {NAV.map((item) => (
        <RailLink key={item.href} item={item} active={item.href === active} />
      ))}
      <div className="hidden flex-1 md:block" />
      <RailLink item={PROFILE} active={active === PROFILE.href} />
      <UserMenu />
    </nav>
  );
}

function UserMenu() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [ending, setEnding] = useState(false);
  const lock = useLock();
  const initials = me.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      forgetMe();
      queryClient.clear();
      router.replace("/login");
    }
  }

  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Your menu"
            className="mt-1 hidden size-10 items-center justify-center rounded-full bg-sidebar-accent text-xs font-bold text-white outline-none transition-colors hover:bg-sidebar-primary focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-primary md:flex"
          >
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side="right" align="end" sideOffset={12}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="grid text-left text-sm leading-tight">
                  <span className="font-medium text-foreground">{me.full_name}</span>
                  <span className="text-xs">
                    {me.username} · Cashier
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={lock}>
              <KeyRound /> Lock till
            </DropdownMenuItem>
            {me.shift && (
              <>
                <DropdownMenuItem onClick={() => setEnding(true)}>
                  <Lock /> End shift
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                <DropdownMenuRadioItem value="light">
                  <Sun /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <EndShiftDialog shiftId={me.shift?.id ?? null} open={ending} onOpenChange={setEnding} />
    </>
  );
}
