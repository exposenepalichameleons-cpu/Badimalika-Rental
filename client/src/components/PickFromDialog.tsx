// ── "Pick From" — where is this stock coming from? ────────────────────────────
//
// Stock is not always in the godown. Some of it is out on rent at a customer's
// site, and a new order can be filled from there: the truck collects it from
// that customer on the way out. This dialog is the choice, shown when a driver
// locks an approved order for dispatch.
//
// Two things it deliberately does NOT do:
//
//   * it does not list every customer. The server filters the list to customers
//     who actually hold one of THIS order's items, because a list of places the
//     stock is not is worse than no list at all;
//   * it does not let a quantity exceed what is available at the chosen place.
//     The cap is enforced here for instant feedback AND re-checked on the server,
//     so a stale screen cannot pick stock that has already gone.
//
// When no customer holds the item, the godown is the only option and the dialog
// says so plainly rather than showing an empty picker.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNote, Modal, Spinner } from "@/components/ui/primitives";
import { formatQty } from "@shared/rental";

export interface PickFromOption {
  orderItemId: string;
  equipmentId: string;
  equipmentName: string;
  qty: number;
  godownQty: number;
  customers: Array<{ customerId: string; customerName: string; qty: number }>;
}

/** The godown is represented by `null` — there is no customer row for it. */
type Source = string | null;

export function PickFromDialog({
  open,
  onClose,
  options,
  loading,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  options: PickFromOption[] | undefined;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (sources: Array<{ orderItemId: string; sourceCustomerId: Source }>) => void;
}) {
  // One choice per order line. Default is the godown, which is the common case
  // and the one that needs no explanation.
  const [chosen, setChosen] = useState<Record<string, Source>>({});

  // Re-seed whenever the dialog opens, so a previous order's choices are never
  // carried into a different one.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, Source> = {};
    for (const o of options ?? []) seed[o.orderItemId] = null;
    setChosen(seed);
  }, [open, options]);

  // A line is only valid when the chosen place can cover the whole quantity.
  // Partial picking from two places is not offered: it would need two movements
  // for one line and a split the ledger cannot explain in a single row.
  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const o of options ?? []) {
      const src = chosen[o.orderItemId] ?? null;
      const available = src === null ? o.godownQty : (o.customers.find((c) => c.customerId === src)?.qty ?? 0);
      if (available < o.qty) {
        out[o.orderItemId] =
          src === null
            ? `The godown only has ${formatQty(available)} free, but this line needs ${formatQty(o.qty)}.`
            : `That customer only has ${formatQty(available)} left, but this line needs ${formatQty(o.qty)}.`;
      }
    }
    return out;
  }, [options, chosen]);

  const blocked = Object.keys(problems).length > 0;
  const anyCustomerPick = Object.values(chosen).some((v) => v !== null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pick from"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm(
                (options ?? []).map((o) => ({
                  orderItemId: o.orderItemId,
                  sourceCustomerId: chosen[o.orderItemId] ?? null,
                })),
              )
            }
            disabled={busy || loading || blocked || !options?.length}
          >
            {busy ? "Locking…" : "Lock for dispatch"}
          </Button>
        </>
      }
    >
      {loading && <Spinner />}

      {!loading && options && options.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose where each item is taken from. Picking from a customer records an automatic
            return from them, so the ledger shows the stock coming back before it goes out again.
          </p>

          {options.map((o) => {
            const src = chosen[o.orderItemId] ?? null;
            const noCustomers = o.customers.length === 0;
            return (
              <div key={o.orderItemId} className="rounded-lg border p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-medium">{o.equipmentName}</span>
                  <span className="text-xs text-muted-foreground">
                    needs {formatQty(o.qty)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {/* Godown */}
                  <label
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                      src === null ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`src-${o.orderItemId}`}
                        checked={src === null}
                        onChange={() => setChosen((c) => ({ ...c, [o.orderItemId]: null }))}
                      />
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      Godown
                    </span>
                    <span
                      className={`text-xs tabular-nums ${
                        o.godownQty < o.qty ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {formatQty(o.godownQty)} available
                    </span>
                  </label>

                  {/* Customers holding this item */}
                  {o.customers.map((c) => (
                    <label
                      key={c.customerId}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                        src === c.customerId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`src-${o.orderItemId}`}
                          checked={src === c.customerId}
                          onChange={() => setChosen((prev) => ({ ...prev, [o.orderItemId]: c.customerId }))}
                        />
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        Pick from {c.customerName}
                      </span>
                      <span
                        className={`text-xs tabular-nums ${
                          c.qty < o.qty ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {formatQty(c.qty)} out on rent
                      </span>
                    </label>
                  ))}
                </div>

                {noCustomers && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    No customer currently has this item out on rent, so it can only come from the godown.
                  </p>
                )}

                {problems[o.orderItemId] && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {problems[o.orderItemId]}
                  </p>
                )}
              </div>
            );
          })}

          {anyCustomerPick && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The stock will be collected from the customer you chose. A “Return from …” movement is
                recorded automatically, and the source order is closed if nothing is left with them.
              </span>
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}

      {!loading && options && options.length === 0 && (
        <p className="text-sm text-muted-foreground">This order has no items to pick.</p>
      )}
    </Modal>
  );
}
