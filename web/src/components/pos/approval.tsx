"use client";

import { ShieldCheck } from "lucide-react";
import { createContext, FormEvent, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";

export type Approval = { username: string; password: string };

/** Thrown when the cashier closes the approval prompt: the action is dropped, nothing to show. */
export class ApprovalCancelled extends Error {
  constructor() {
    super("Not approved.");
  }
}

type Ask = (reason: string) => Promise<Approval>;
const ApprovalContext = createContext<Ask | null>(null);

/** One supervisor prompt for the whole till. A supervisor types their own ERP login. */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [reason, setReason] = useState<string | null>(null);
  const [form, setForm] = useState<Approval>({ username: "", password: "" });
  const pending = useRef<{ resolve: (a: Approval) => void; reject: (e: Error) => void } | null>(null);

  const ask = useCallback<Ask>((why) => {
    pending.current?.reject(new ApprovalCancelled());
    setForm({ username: "", password: "" });
    setReason(why);
    return new Promise<Approval>((resolve, reject) => {
      pending.current = { resolve, reject };
    });
  }, []);

  function close() {
    pending.current?.reject(new ApprovalCancelled());
    pending.current = null;
    setReason(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    pending.current?.resolve(form);
    pending.current = null;
    setReason(null);
  }

  return (
    <ApprovalContext.Provider value={ask}>
      {children}
      <Dialog open={reason !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5" /> Supervisor approval
              </DialogTitle>
              <DialogDescription>{reason} A manager enters their own ERP login.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="appr-user">Supervisor username</FieldLabel>
                <Input id="appr-user" autoFocus autoComplete="off" required value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="appr-pass">Password</FieldLabel>
                <Input id="appr-pass" type="password" autoComplete="off" required value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit">Approve</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ApprovalContext.Provider>
  );
}

/**
 * Run an action; if the server says it needs a supervisor, ask for one and run it again with the
 * approval. `withApproval(a => post(url, { ...body, approval: a }))`.
 */
export function useApproval() {
  const ask = useContext(ApprovalContext);
  if (!ask) throw new Error("useApproval outside ApprovalProvider");
  return useCallback(
    async <T,>(run: (approval: Approval | undefined) => Promise<T>, upfront?: string): Promise<T> => {
      if (upfront) return run(await ask(upfront));
      try {
        return await run(undefined);
      } catch (e) {
        if (e instanceof ApiError && e.approvalRequired) return run(await ask(e.message));
        throw e;
      }
    },
    [ask],
  );
}
