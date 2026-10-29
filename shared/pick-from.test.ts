import { describe, expect, it } from "vitest";
import { buildMovementReport, type LedgerMovement } from "./stock-ledger";

/**
 * "Pick From" — the ledger arithmetic when stock is collected from a customer's
 * site instead of the godown.
 *
 * The scenario these pin: an item is out on rent at Customer Y. A new order is
 * filled from Y, so the lock writes an automatic `in` (it came back from Y) and
 * the dispatch that follows writes an `out` (it went out on the new order). The
 * net effect on stock on hand is ZERO — the item is still out on rent, just with
 * a different customer — and the running balance must show both steps rather
 * than jumping.
 */

function mv(partial: Partial<LedgerMovement> & { dateAd: string; type: "in" | "out"; qty: number }): LedgerMovement {
  return {
    id: partial.id ?? `${partial.dateAd}-${partial.type}-${partial.qty}-${partial.createdAt ?? ""}`,
    dateBs: partial.dateBs ?? "2083-01-01",
    orderNo: partial.orderNo ?? null,
    invoiceNo: partial.invoiceNo ?? null,
    customerName: partial.customerName ?? null,
    personName: partial.personName ?? null,
    personRole: partial.personRole ?? null,
    createdAt: partial.createdAt ?? `${partial.dateAd}T10:00:00.000Z`,
    ...partial,
  } as LedgerMovement;
}

describe("pick from a customer — the automatic return then the out", () => {
  it("shows the return and the dispatch in sequence, ending where it started", () => {
    // 100 owned, 10 out at Customer Y, so 90 on hand.
    const r = buildMovementReport({
      openingBase: 100,
      closingOnHand: 90,
      movements: [
        mv({ dateAd: "2026-10-01", type: "out", qty: 10, customerName: "Customer Y" }),
        // The lock: 4 come back from Y.
        mv({
          dateAd: "2026-10-20",
          type: "in",
          qty: 4,
          customerName: "Customer Y",
          sourceCustomerName: "Customer Y",
          autoReturn: true,
          createdAt: "2026-10-20T09:00:00.000Z",
        }),
        // The dispatch: the same 4 go out on the new order.
        mv({
          dateAd: "2026-10-20",
          type: "out",
          qty: 4,
          customerName: "Customer Z",
          createdAt: "2026-10-20T11:00:00.000Z",
        }),
      ],
    });

    expect(r.rows.map((x) => x.balance)).toEqual([90, 94, 90]);
    expect(r.closing).toBe(90);
    // The pick is stock-neutral: it moved between customers, it did not come home.
    expect(r.drift).toBe(0);
  });

  it("keeps the balance correct when the range starts on the pick day", () => {
    const movements = [
      mv({ dateAd: "2026-10-01", type: "out", qty: 10 }),
      mv({
        dateAd: "2026-10-20",
        type: "in",
        qty: 4,
        autoReturn: true,
        createdAt: "2026-10-20T09:00:00.000Z",
      }),
      mv({ dateAd: "2026-10-20", type: "out", qty: 4, createdAt: "2026-10-20T11:00:00.000Z" }),
    ];

    const r = buildMovementReport({
      openingBase: 100,
      closingOnHand: 90,
      movements,
      fromAd: "2026-10-20",
    });

    // Everything before the range rolls into the opening: 100 − 10 = 90.
    expect(r.opening).toBe(90);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((x) => x.balance)).toEqual([94, 90]);
    expect(r.closing).toBe(90);
  });

  it("reverses the automatic return when the lock is undone", () => {
    // Lock wrote `in` 4; undo writes `out` 4 pointing at it. Net zero, and the
    // customer still holds the stock.
    const r = buildMovementReport({
      openingBase: 100,
      closingOnHand: 90,
      movements: [
        mv({ dateAd: "2026-10-01", type: "out", qty: 10 }),
        mv({
          dateAd: "2026-10-20",
          type: "in",
          qty: 4,
          autoReturn: true,
          createdAt: "2026-10-20T09:00:00.000Z",
        }),
        mv({
          dateAd: "2026-10-20",
          type: "out",
          qty: 4,
          reversalOfId: "auto-1",
          note: "Undo lock — the pick from this customer was cancelled",
          createdAt: "2026-10-20T10:00:00.000Z",
        }),
      ],
    });

    expect(r.rows.map((x) => x.balance)).toEqual([90, 94, 90]);
    expect(r.closing).toBe(90);
    expect(r.drift).toBe(0);
  });

  it("does not double-count when the same pick is reversed twice", () => {
    // The UNIQUE index on reversal_of_id makes a second reversal row impossible,
    // so the ledger can only ever hold one. This pins the arithmetic that follows
    // from that: one `in`, one `out`, back to the starting balance.
    const r = buildMovementReport({
      openingBase: 100,
      closingOnHand: 90,
      movements: [
        mv({ dateAd: "2026-10-01", type: "out", qty: 10 }),
        mv({ dateAd: "2026-10-20", type: "in", qty: 4, autoReturn: true, createdAt: "2026-10-20T09:00:00.000Z" }),
        mv({ dateAd: "2026-10-20", type: "out", qty: 4, reversalOfId: "auto-1", createdAt: "2026-10-20T10:00:00.000Z" }),
      ],
    });
    expect(r.totalIn).toBe(4);
    expect(r.totalOut).toBe(14);
    expect(r.closing).toBe(90);
  });
});
