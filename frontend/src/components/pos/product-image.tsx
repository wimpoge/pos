import {
  BatteryCharging,
  Cable,
  Camera,
  Gamepad2,
  Headphones,
  Keyboard,
  Laptop,
  MemoryStick,
  Package,
  PlugZap,
  ShieldCheck,
  Smartphone,
  Speaker,
  Tablet,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";
import { cn } from "@/lib/utils";

// Matched on words in the ERP's category name, so a category added there later still gets a
// fitting picture. First match wins: "Power Banks" is a battery, not a bank card.
const ICONS: [RegExp, LucideIcon][] = [
  [/power ?bank|battery/i, BatteryCharging],
  [/cable|cord/i, Cable],
  [/charger|adapter|plug/i, PlugZap],
  [/case|protect|glass|screen guard/i, ShieldCheck],
  [/earbud|headphone|headset|audio/i, Headphones],
  [/speaker/i, Speaker],
  [/watch|wearable/i, Watch],
  [/tablet|ipad/i, Tablet],
  [/laptop|notebook/i, Laptop],
  [/phone/i, Smartphone],
  [/camera/i, Camera],
  [/keyboard|mouse/i, Keyboard],
  [/game|console/i, Gamepad2],
  [/memory|storage|flash|sd ?card/i, MemoryStick],
];

export function productIcon(category: string | null | undefined): LucideIcon {
  return ICONS.find(([pattern]) => pattern.test(category ?? ""))?.[1] ?? Package;
}

/** A product's picture: an icon for its category, on a soft tile. The ERP keeps no photos. */
export function ProductImage({
  category,
  size = "md",
  className,
}: {
  category: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
        size === "sm" && "size-8 [&_svg]:size-4",
        size === "md" && "size-10 [&_svg]:size-5",
        size === "lg" && "h-16 w-full [&_svg]:size-8",
        className,
      )}
    >
      {createElement(productIcon(category), { strokeWidth: 1.5 })}
    </span>
  );
}
