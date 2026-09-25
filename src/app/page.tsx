import { Suspense } from "react";
import { LedgerDemo } from "./ledger-demo";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="wrap">
      <p className="eyebrow">Stripe credit ledger kit</p>
      <h1>Credits on your Stripe. The gate lives in your database.</h1>
      <p className="lede">
        Checkout packs grant a balance. <code>check</code> is advisory. <code>reserve</code> then{" "}
        <code>finalize</code> or <code>release</code> is the hard gate. This page is a thin demo shell,
        not a chat product. You own the code. Nothing here is hosted for you.
      </p>

      <Suspense fallback={<p className="loading">Loading balance…</p>}>
        <LedgerDemo />
      </Suspense>

      <section className="card honesty">
        <h2>Use Autumn or Metronome instead when…</h2>
        <ul>
          <li>You do not need a hard stop the moment the balance hits zero. Stripe Credit Grants settle at invoice time.</li>
          <li>You do not want to maintain webhook idempotency, races, and failed-call releases. Use Autumn.</li>
          <li>You need Stripe’s real-time prepaid platform (rating, commits, burndown). Use Metronome.</li>
          <li>You wanted a full AI app boilerplate. This repo is the billing module.</li>
        </ul>
        <p className="note" style={{ marginTop: 12 }}>
          The longer version is the README section with the same name, and the free chapter in{" "}
          <code>docs/stripe-credit-grants-are-invoice-time.md</code>.
        </p>
      </section>
    </main>
  );
}
