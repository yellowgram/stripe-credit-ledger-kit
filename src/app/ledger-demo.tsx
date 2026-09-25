"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Pack = {
  id: string;
  name: string;
  credits: number;
  amountCents: number;
  currency: string;
  description: string;
};

type Entry = {
  id: string;
  delta: number;
  kind: string;
  status: string | null;
  note: string | null;
  packId: string | null;
  createdAt: string;
};

type Snapshot = {
  userId: string;
  balance: number;
  paused?: boolean;
  demoControls?: boolean;
  packs: Pack[];
  entries: Entry[];
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function LedgerDemo() {
  const search = useSearchParams();
  const checkout = search.get("checkout");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const reload = useCallback(async () => {
    const response = await fetch("/api/balance", { cache: "no-store" });
    const body = (await response.json()) as Snapshot & { error?: string; detail?: string };
    if (!response.ok) {
      throw new Error(body.detail || body.error || "balance_failed");
    }
    setSnapshot(body);
  }, []);

  useEffect(() => {
    reload().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "balance_failed");
    });
  }, [reload]);

  async function run(name: string, url: string, payload: unknown) {
    setPending(name);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      setResult({ status: response.status, body });
      if (url === "/api/checkout") {
        const checkoutBody = body as { url?: string; error?: string; detail?: string };
        if (checkoutBody.url) {
          window.location.href = checkoutBody.url;
          return;
        }
        setError(checkoutBody.detail || checkoutBody.error || "checkout_failed");
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request_failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid">
      <section className="card" aria-live="polite">
        <p className="balance-label">Spendable balance</p>
        <p className="balance">{snapshot ? snapshot.balance : "–"}</p>
        <p className="user">
          Demo user <code>{snapshot?.userId ?? "…"}</code>. No login. This shell is not a production app.
        </p>
        {snapshot?.paused ? (
          <p className="banner">This user is paused after a refund or dispute. A new grant does not clear it. Demo reset does.</p>
        ) : null}
        {checkout === "success" ? (
          <p className="banner">Stripe sent the browser back. The balance moves when the webhook lands, not when this page loads.</p>
        ) : null}
        {checkout === "cancel" ? <p className="banner">Checkout canceled. No credits granted.</p> : null}
        {error ? <p className="banner">{error}</p> : null}

        {!snapshot ? (
          <p className="note" style={{ marginTop: 16 }}>Loading demo controls…</p>
        ) : snapshot.demoControls ? (
          <div className="actions" style={{ marginTop: 16 }}>
            <div className="row">
              <button className="primary" disabled={pending !== null} onClick={() => run("spend", "/api/demo/generate", { credits: 10, fail: false })}>
                {pending === "spend" ? "Reserving…" : "Spend 10 (succeeds)"}
              </button>
              <button className="danger" disabled={pending !== null} onClick={() => run("fail", "/api/demo/generate", { credits: 10, fail: true })}>
                {pending === "fail" ? "Releasing…" : "Spend 10 (provider fails)"}
              </button>
            </div>
            <div className="row">
              <button className="ghost" disabled={pending !== null} onClick={() => run("race", "/api/demo/race", { amount: 10 })}>
                {pending === "race" ? "Racing…" : "Last-credit race (two spends of 10)"}
              </button>
              <button className="ghost" disabled={pending !== null} onClick={() => run("reset", "/api/demo/reset", { target: 100 })}>
                {pending === "reset" ? "Resetting…" : "Reset demo balance to 100"}
              </button>
            </div>
          </div>
        ) : (
          <p className="note" style={{ marginTop: 16 }}>
            Spend, race, reset, and Checkout are off. Set <code>ALLOW_DEMO_CONTROLS=true</code> for a local walkthrough.
          </p>
        )}
        {snapshot ? (
          <p className="note" style={{ marginTop: 12 }}>
            {snapshot.demoControls
              ? "Failed calls reserve, then release. The race sets the balance to 10 and fires two spends. One succeeds."
              : "Your app owns real auth. Do not ship this page as the product."}
          </p>
        ) : null}
        {result ? <pre className="result">{JSON.stringify(result, null, 2)}</pre> : null}
      </section>

      <section className="card">
        <h2>Buy credits</h2>
        <p className="note">Stripe Checkout, test mode. The grant uses the catalog and the paid amount. Session metadata is not the credit authority.</p>
        <div className="packs">
          {(snapshot?.packs ?? []).map((pack) => (
            <div className="pack" key={pack.id}>
              <div>
                <h3>{pack.name}</h3>
                <p>
                  {pack.credits.toLocaleString("en-US")} credits · {money(pack.amountCents, pack.currency)}
                </p>
              </div>
              {snapshot?.demoControls ? (
                <button className="ghost" disabled={pending !== null} onClick={() => run(pack.id, "/api/checkout", { packId: pack.id })}>
                  {pending === pack.id ? "Opening…" : "Buy"}
                </button>
              ) : null}
            </div>
          ))}
          {snapshot && snapshot.packs.length === 0 ? <p className="note">No packs configured.</p> : null}
        </div>
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Ledger</h2>
        <p className="note">Append-only. Reserve takes credits. Finalize keeps them. Release puts them back.</p>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Delta</th>
              <th>Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot?.entries ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{entry.createdAt.replace("T", " ").replace("Z", "")}</td>
                <td>{entry.kind}</td>
                <td className={entry.delta > 0 ? "delta-pos" : entry.delta < 0 ? "delta-neg" : undefined}>
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </td>
                <td>{entry.status ?? "—"}</td>
                <td>{entry.note ?? entry.packId ?? "—"}</td>
              </tr>
            ))}
            {snapshot && snapshot.entries.length === 0 ? (
              <tr>
                <td colSpan={5}>No entries yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
