import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credit ledger kit",
  description: "Prepaid credits on your Stripe. Real-time balance gate in your database.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
