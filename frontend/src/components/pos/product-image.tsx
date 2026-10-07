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
// fitting picture and colour. First match wins: "Power Banks" is a battery, not a bank card.
const KINDS: [RegExp, LucideIcon, string][] = [
  [/power ?bank|battery/i, BatteryCharging, "bg-[#e8f5e1] text-[#3f6212] dark:bg-[#3f6212]/25 dark:text-[#b5e08a]"],
  [/cable|cord/i, Cable, "bg-[#f1e8fd] text-[#6b21a8] dark:bg-[#6b21a8]/25 dark:text-[#d8b4fe]"],
  [/charger|adapter|plug/i, PlugZap, "bg-[#fdebdd] text-[#9a3412] dark:bg-[#9a3412]/25 dark:text-[#fdba8c]"],
  [/case|protect|glass|screen guard/i, ShieldCheck, "bg-[#ddf3f0] text-[#0f766e] dark:bg-[#0f766e]/25 dark:text-[#7fdcd0]"],
  [/earbud|headphone|headset|audio/i, Headphones, "bg-[#fde7ef] text-[#be185d] dark:bg-[#be185d]/25 dark:text-[#f9a8d4]"],
  [/speaker/i, Speaker, "bg-[#fde7ef] text-[#be185d] dark:bg-[#be185d]/25 dark:text-[#f9a8d4]"],
  [/watch|wearable/i, Watch, "bg-[#dcebff] text-[#1e40af] dark:bg-[#1e40af]/30 dark:text-[#a5c4ff]"],
  [/tablet|ipad/i, Tablet, "bg-[#fff1d6] text-[#8a4b00] dark:bg-[#8a4b00]/30 dark:text-[#f8cf85]"],
  [/laptop|notebook/i, Laptop, "bg-[#e6e9f2] text-[#334155] dark:bg-white/10 dark:text-[#cbd5e1]"],
  [/phone/i, Smartphone, "bg-[#e6e9f2] text-[#26305a] dark:bg-white/10 dark:text-[#c7d2fe]"],
  [/camera/i, Camera, "bg-[#e6e9f2] text-[#334155] dark:bg-white/10 dark:text-[#cbd5e1]"],
  [/keyboard|mouse/i, Keyboard, "bg-[#e6e9f2] text-[#334155] dark:bg-white/10 dark:text-[#cbd5e1]"],
  [/game|console/i, Gamepad2, "bg-[#f1e8fd] text-[#6b21a8] dark:bg-[#6b21a8]/25 dark:text-[#d8b4fe]"],
  [/memory|storage|flash|sd ?card/i, MemoryStick, "bg-[#ddf3f0] text-[#0f766e] dark:bg-[#0f766e]/25 dark:text-[#7fdcd0]"],
];
const OTHER = "bg-muted text-muted-foreground";

function kind(category: string | null | undefined) {
  return KINDS.find(([pattern]) => pattern.test(category ?? ""));
}

export function productIcon(category: string | null | undefined): LucideIcon {
  return kind(category)?.[1] ?? Package;
}

/** Two letters for a product, from the words after the brand: "Amazfit Watch 3 Ultra" is W3,
 * "Anker GaN Charger 100W" is GC, "Xiaomi Power Bank 20000" is PB. */
export function productInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const rest = words.length > 1 ? words.slice(1) : words;
  const letters = rest.slice(0, 2).map((w) => w[0]);
  if (letters.length === 1) letters.push(rest[0][1] ?? "");
  return letters.join("").toUpperCase();
}

/** A product's picture: its initials (or, without a name, its category's icon) on a tile in its
 * category's colour; grey when the store has none left. The ERP keeps no photos. */
export function ProductImage({
  name,
  category,
  out = false,
  size = "md",
  className,
}: {
  name?: string;
  category: string | null | undefined;
  out?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const match = kind(category);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-extrabold tracking-tight",
        out ? "bg-muted text-muted-foreground/70" : (match?.[2] ?? OTHER),
        size === "sm" && "size-8 text-xs [&_svg]:size-4",
        size === "md" && "size-11 text-sm [&_svg]:size-5",
        size === "lg" && "h-16 w-full text-2xl [&_svg]:size-8",
        className,
      )}
    >
      {name ? productInitials(name) : createElement(match?.[1] ?? Package, { strokeWidth: 1.5 })}
    </span>
  );
}
