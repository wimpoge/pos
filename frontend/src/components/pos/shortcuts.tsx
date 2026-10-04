"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const SHORTCUTS: [key: string, what: string][] = [
  ["F1", "These shortcuts"],
  ["F2", "Scan or search"],
  ["F3", "Open the cart"],
  ["F4", "Pick the customer"],
  ["F6", "Put the cart on hold"],
  ["F7", "Carts on hold"],
  ["F8", "Voucher code"],
  ["F9", "Pay"],
  ["F10", "Take goods back (returns)"],
  ["+ / −", "One more / one less of the last item (search box empty)"],
  ["Esc", "Clear the search"],
  ["Enter", "In the payment window: complete the sale"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>A barcode scanner types into the search box and presses Enter by itself.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
              </dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
