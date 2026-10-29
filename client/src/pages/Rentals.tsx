import { useLocation } from "wouter";
import { PackageCheck, Undo2, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/_core/trpc";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader, Table, THead, TBody, TR, TH, TD, Spinner, EmptyState, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionFeedback } from "@/components/ui/action";
import { relativeTime } from "@/lib/format";
import { HOT_POLL_MS, pollWhileOnline } from "@/lib/live";
import { patchOrderStatus, restoreSnapshot, snapshotPaths } from "@/lib/optimistic";

export default function Rentals() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const qc = useQueryClient();
  // Polled: a dispatch by a driver puts a new row here within seconds, and a
  // pickup removes one — both used to need a manual reload.
  const onRent = trpc.rentals.onRent.useQuery(undefined, {
    refetchInterval: pollWhileOnline(HOT_POLL_MS),
  });
  const ret = trpc.orders.return.useMutation({
    // The row leaves the list on the click, and comes back only if the server
    // refuses — so "Picked up" responds instantly without ever lying.
    onMutate: async (vars: { id: string }) => {
      const snaps = snapshotPaths(qc, ["rentals.onRent", "orders.list", "orders.get"]);
      patchOrderStatus(qc, vars.id, "returned");
      return { snaps };
    },
    onError: (_e: unknown, _v: unknown, ctx: { snaps?: ReturnType<typeof snapshotPaths> } | undefined) =>
      restoreSnapshot(qc, ctx?.snaps),
    onSuccess: () => {
      void utils.rentals.onRent.invalidate();
      void utils.orders.list.invalidate();
      void utils.orders.get.invalidate();
      void utils.dashboard.summary.invalidate();
      void utils.equipment.list.invalidate();
    },
  });

  const rows = onRent.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        title="On Rent"
        subtitle="Products currently out with customers. When any driver picks one up, mark it returned and it goes back to Stock."
      />

      {onRent.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-5 w-5" />}
          title="Nothing on rent"
          description="Once a driver marks an order Dispatched, its products appear here until they are picked up."
          action={<Button onClick={() => navigate("/orders")}>Go to orders</Button>}
        />
      ) : (
        <>
          <ActionFeedback items={[{ mutation: ret, done: "Picked up — the equipment is back in stock." }]} />
          <Table>
          <THead>
            <TR>
              <TH>Customer</TH>
              <TH>Invoice</TH>
              <TH>Driver on trip</TH>
              <TH>Vehicle</TH>
              <TH>Delivery location</TH>
              <TH>Dispatched</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.customerName ?? "—"}</TD>
                <TD>
                  <Badge tone="muted">{r.invoiceNo ?? "—"}</Badge>
                </TD>
                <TD className="text-muted-foreground">
                  {r.driverName ?? "—"}
                  {r.creatorName && r.creatorName !== r.driverName && (
                    <span className="block text-[11px] text-muted-foreground/70">created by {r.creatorName}</span>
                  )}
                </TD>
                <TD className="text-muted-foreground">
                  {r.vehicleName ? `${r.vehicleName} (${r.vehicleNumber})` : "—"}
                </TD>
                {/* Where the equipment actually is. The captured dispatch point
                    wins; the customer's saved site is the fallback for orders
                    dispatched before capture existed. */}
                <TD className="text-muted-foreground">
                  <DeliveryCell row={r} />
                </TD>
                <TD className="text-muted-foreground">{relativeTime(r.dispatchedAt)}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/orders/${r.id}`)}>
                      View
                    </Button>
                    <ActionButton
                      mutation={ret}
                      size="sm"
                      idle="Picked up"
                      busy="Picking up…"
                      icon={<Undo2 className="h-4 w-4" />}
                      onClick={() => ret.mutate({ id: r.id })}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Tip: the order date in Bikram Sambat is shown on each order's detail page.
      </p>
    </AppLayout>
  );
}

/**
 * The deployed equipment's location, as captured at dispatch.
 *
 * Three honest states, and the difference between them matters:
 *   captured    — a real GPS fix; coordinates are clickable through to a map
 *   unavailable — the driver dispatched without a fix; we say so rather than
 *                 showing the customer's saved site as if it were the delivery
 *   none        — dispatched before capture existed; fall back to the saved site
 */
function DeliveryCell({
  row,
}: {
  row: {
    deliveryLocationStatus?: string | null;
    deliveryAddress?: string | null;
    deliveryLatitude?: number | null;
    deliveryLongitude?: number | null;
    deliveryCapturedAt?: string | Date | null;
    customerAddress?: string | null;
    customerLatitude?: number | null;
    customerLongitude?: number | null;
  };
}) {
  const captured =
    row.deliveryLocationStatus === "captured" && row.deliveryLatitude != null && row.deliveryLongitude != null;

  if (captured) {
    return (
      <div className="max-w-[16rem]">
        <span className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-foreground">{row.deliveryAddress ?? "Captured location"}</span>
        </span>
        <a
          href={`https://www.google.com/maps?q=${row.deliveryLatitude},${row.deliveryLongitude}`}
          target="_blank"
          rel="noreferrer"
          className="ml-5 font-mono text-[11px] text-primary underline underline-offset-2"
          title="Open in map"
        >
          {row.deliveryLatitude!.toFixed(5)}, {row.deliveryLongitude!.toFixed(5)}
        </a>
        {row.deliveryCapturedAt && (
          <span className="ml-5 block text-[11px] text-muted-foreground/70">
            captured {relativeTime(row.deliveryCapturedAt)}
          </span>
        )}
      </div>
    );
  }

  if (row.deliveryLocationStatus === "unavailable") {
    return (
      <div className="max-w-[16rem]">
        <span className="text-amber-600 dark:text-amber-400">Location unavailable</span>
        {row.deliveryAddress && <span className="block text-[11px]">{row.deliveryAddress}</span>}
        <span className="block text-[11px] text-muted-foreground/70">no GPS fix at dispatch</span>
      </div>
    );
  }

  // Older order: no capture. Show the customer's saved site, labelled as such so
  // it is never mistaken for a captured delivery point.
  if (row.customerLatitude != null && row.customerLongitude != null) {
    return (
      <div className="max-w-[16rem]">
        <span>{row.customerAddress ?? "Customer site"}</span>
        <a
          href={`https://www.google.com/maps?q=${row.customerLatitude},${row.customerLongitude}`}
          target="_blank"
          rel="noreferrer"
          className="block font-mono text-[11px] text-primary underline underline-offset-2"
        >
          {row.customerLatitude.toFixed(5)}, {row.customerLongitude.toFixed(5)}
        </a>
        <span className="block text-[11px] text-muted-foreground/70">customer's saved site</span>
      </div>
    );
  }

  return <span className="text-muted-foreground/60">—</span>;
}
