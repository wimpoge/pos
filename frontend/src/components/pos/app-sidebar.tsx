"use client";

import {
  ChevronsUpDown,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { forgetMe, useMe } from "@/lib/auth";

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

export function AppSidebar() {
  const me = useMe();
  const active = findNav(usePathname())?.href;

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ShoppingCart className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">POS</span>
                <span className="truncate text-xs text-muted-foreground">
                  {me.shift ? me.shift.store.name : me.company.name || "No shift open"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton isActive={item.href === active} tooltip={item.title} render={<Link href={item.href} />}>
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={active === PROFILE.href} tooltip={PROFILE.title} render={<Link href={PROFILE.href} />}>
              <PROFILE.icon />
              <span>{PROFILE.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{me.full_name}</span>
              <span className="truncate text-xs text-muted-foreground">Cashier</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side="top" align="start">
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
