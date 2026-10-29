// ── Reverse geocoding: coordinates → a readable address ───────────────────────
//
// The driver's device gives us a GPS fix at dispatch. Coordinates alone are not
// an address a human can act on, so we ask a geocoder to name the place.
//
// DESIGN NOTES
//
//   * This is BEST EFFORT and must never block a dispatch. A dispatch is a real
//     business event — the truck is loaded and leaving — and a third-party HTTP
//     call is not allowed to stand in its way. Every failure path returns null
//     and the caller falls back to the customer's saved address or whatever the
//     driver typed.
//
//   * Nominatim (OpenStreetMap) is used because it needs no API key, which
//     matters for an app the owner deploys themselves. Its usage policy requires
//     a descriptive User-Agent and at most one request per second; we send one
//     request per dispatch, which is far inside that.
//
//   * The result is cached in-process by rounded coordinate. Two dispatches to
//     the same yard within a session cost one lookup, and a geocoder outage
//     cannot turn into a per-dispatch timeout storm.

import { outboundFetch } from "../_core/fetch";

/** ~11 m at the equator — close enough to share a cached address. */
const CACHE_PRECISION = 4;

const cache = new Map<string, string | null>();

export interface ReverseGeocodeResult {
  address: string | null;
  /** Which provider answered, for the audit trail. Null when none did. */
  provider: string | null;
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(CACHE_PRECISION)},${lng.toFixed(CACHE_PRECISION)}`;
}

/**
 * Turn a coordinate into a human address. Returns `{ address: null }` rather
 * than throwing when the geocoder is unreachable, rate-limited or has no match —
 * the caller stores the coordinates regardless.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { address: null, provider: null };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { address: null, provider: null };

  const key = cacheKey(lat, lng);
  if (cache.has(key)) return { address: cache.get(key) ?? null, provider: cache.get(key) ? "nominatim" : null };

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await outboundFetch(url, {
      timeoutMs: 6000,
      headers: {
        // Nominatim's policy requires an identifying User-Agent.
        "User-Agent": "EquipmentRentalApp/1.0 (dispatch delivery capture)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      cache.set(key, null);
      return { address: null, provider: null };
    }
    const body = (await res.json()) as { display_name?: string };
    const address = typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : null;
    cache.set(key, address);
    return { address, provider: address ? "nominatim" : null };
  } catch {
    // Timeout, DNS, TLS, malformed JSON — all the same to us: no address.
    cache.set(key, null);
    return { address: null, provider: null };
  }
}
