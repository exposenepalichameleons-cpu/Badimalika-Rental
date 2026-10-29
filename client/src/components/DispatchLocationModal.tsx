// ── Delivery location capture at dispatch ─────────────────────────────────────
//
// When a driver confirms a dispatch, we want to know WHERE the equipment was
// actually handed over — not just which customer it went to. The customer's
// saved site is where they usually are; this is where the truck really went.
//
// THE RULE THIS SCREEN EXISTS TO KEEP: a dispatch is a real business event and
// must never be blocked by a location problem. So every failure path here ends
// in a way forward:
//
//   * permission denied / no fix / timeout → a clear message, a Retry button,
//     and a "Dispatch without location" button that records the truth
//     (`unavailable`) rather than inventing coordinates;
//   * reverse geocoding unavailable → the coordinates are still shown and
//     stored, and the driver can type the address themselves.
//
// Nothing here writes a fake 0,0 or copies the customer's saved point as if it
// were a fix. A map that lies is worse than a map with a gap.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Crosshair, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorNote, Modal } from "@/components/ui/primitives";
import { trpc } from "@/_core/trpc";

export interface CapturedLocation {
  status: "captured" | "unavailable";
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address: string | null;
  capturedAt: string | null;
}

type Phase = "locating" | "ready" | "failed";

/** Human-readable reason for a GeolocationPositionError. */
function explain(err: GeolocationPositionError | null): string {
  if (!err) return "Could not get a location fix.";
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission was denied. Allow location access for this site, then retry — or dispatch without a location.";
    case err.POSITION_UNAVAILABLE:
      return "The device could not get a GPS fix. Move somewhere with a clearer view of the sky, then retry.";
    case err.TIMEOUT:
      return "Getting a location fix timed out. Retry, or dispatch without a location.";
    default:
      return err.message || "Could not get a location fix.";
  }
}

export function DispatchLocationModal({
  open,
  onClose,
  customerName,
  customerAddress,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  customerName: string | null;
  /** The customer's saved address, offered as a starting point for the text. */
  customerAddress: string | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: (loc: CapturedLocation) => void;
}) {
  const [phase, setPhase] = useState<Phase>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  // Guards against a late geolocation callback landing after the dialog closed
  // or after a retry superseded it.
  const attempt = useRef(0);

  const geocode = trpc.orders.reverseGeocode.useQuery(
    { latitude: coords?.lat ?? 0, longitude: coords?.lng ?? 0 },
    { enabled: !!coords, retry: false, staleTime: 5 * 60_000 },
  );

  const locate = useCallback(() => {
    const mine = ++attempt.current;
    setPhase("locating");
    setFailure(null);
    setCoords(null);
    setGeocodeNote(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPhase("failed");
      setFailure("This device or browser does not support location. Dispatch without a location, or type the address.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (mine !== attempt.current) return;
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        });
        setPhase("ready");
      },
      (err) => {
        if (mine !== attempt.current) return;
        setPhase("failed");
        setFailure(explain(err));
      },
      // High accuracy: the point that matters is which gate the truck is at,
      // not which town. 20s is long enough for a cold GPS fix outdoors.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  // Start a fresh capture every time the dialog opens, so a previous order's
  // coordinates are never carried into this one.
  useEffect(() => {
    if (!open) return;
    setAddress(customerAddress ?? "");
    locate();
    return () => {
      // Invalidate any in-flight callback from this opening.
      attempt.current++;
    };
  }, [open, customerAddress, locate]);

  // Fill the address from the geocoder once it answers — but never overwrite
  // something the driver has already typed.
  useEffect(() => {
    if (!coords) return;
    if (geocode.isLoading) return;
    const found = geocode.data?.address ?? null;
    if (found) {
      setAddress((prev) => (prev.trim() ? prev : found));
      setGeocodeNote(null);
    } else if (!geocode.isLoading) {
      setGeocodeNote(
        "Could not look up a street address for these coordinates. They are still saved — add the address yourself if you want it on record.",
      );
    }
  }, [coords, geocode.data, geocode.isLoading]);

  const confirmCaptured = () => {
    if (!coords) return;
    onConfirm({
      status: "captured",
      latitude: coords.lat,
      longitude: coords.lng,
      accuracy: coords.acc,
      address: address.trim() || null,
      capturedAt: new Date().toISOString(),
    });
  };

  const confirmUnavailable = () => {
    onConfirm({
      status: "unavailable",
      latitude: null,
      longitude: null,
      accuracy: null,
      address: address.trim() || null,
      capturedAt: new Date().toISOString(),
    });
  };

  const footer =
    phase === "ready" ? (
      <>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="outline" onClick={locate} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
        <Button onClick={confirmCaptured} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {busy ? "Dispatching…" : "Confirm & dispatch"}
        </Button>
      </>
    ) : phase === "failed" ? (
      <>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="outline" onClick={locate} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
        <Button onClick={confirmUnavailable} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          {busy ? "Dispatching…" : "Dispatch without location"}
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button disabled>
          <Loader2 className="h-4 w-4 animate-spin" /> Getting location…
        </Button>
      </>
    );

  return (
    <Modal open={open} onClose={onClose} title="Confirm delivery location" footer={footer}>
      <p className="text-sm text-muted-foreground">
        Dispatching to <span className="font-medium text-foreground">{customerName ?? "this customer"}</span>. We record
        where the equipment is handed over, so the owner can find it later.
      </p>

      {phase === "locating" && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Crosshair className="h-5 w-5 animate-pulse text-primary" />
          <div>
            <p className="font-medium">Getting a high-accuracy GPS fix…</p>
            <p className="text-xs text-muted-foreground">Allow location access if your browser asks.</p>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">Location not captured</p>
              <p className="text-muted-foreground">{failure}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            You can still dispatch. The order will be recorded as{" "}
            <span className="font-medium">location unavailable</span> — no coordinates are invented.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="dlv-addr-fail">Address (optional)</Label>
            <Input
              id="dlv-addr-fail"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Ring Road, Kalanki, Kathmandu"
            />
          </div>
        </div>
      )}

      {phase === "ready" && coords && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">Location captured</p>
              <p className="font-mono text-xs text-muted-foreground">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                {coords.acc != null && ` · ±${Math.round(coords.acc)} m`}
              </p>
              <a
                href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline underline-offset-2"
              >
                Open in map
              </a>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dlv-addr">Delivery address</Label>
            <Input
              id="dlv-addr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={geocode.isLoading ? "Looking up the address…" : "Type the delivery address"}
            />
            {geocode.isLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Looking up the street address…
              </p>
            )}
            {geocodeNote && <p className="text-xs text-amber-600 dark:text-amber-400">{geocodeNote}</p>}
            {customerAddress && address.trim() !== customerAddress.trim() && (
              <button
                type="button"
                onClick={() => setAddress(customerAddress)}
                className="text-xs text-primary underline underline-offset-2"
              >
                Use the customer's saved address
              </button>
            )}
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
