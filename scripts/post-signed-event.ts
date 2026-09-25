import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const replay = process.argv.includes("--replay");
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!secret || secret.includes("replace_me")) {
  console.error("Set STRIPE_WEBHOOK_SECRET in .env.local to the value the app is using.");
  process.exit(1);
}

const statePath = path.resolve("data/last-demo-event.json");
let eventId = `evt_demo_${Date.now()}`;
let sessionId = `cs_demo_${Date.now()}`;

if (replay) {
  if (!fs.existsSync(statePath)) {
    console.error("No data/last-demo-event.json. Run without --replay first.");
    process.exit(1);
  }
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8")) as { eventId: string; sessionId: string };
  eventId = saved.eventId;
  sessionId = saved.sessionId;
} else {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ eventId, sessionId }, null, 2));
}

const event = {
  id: eventId,
  object: "event",
  api_version: "2024-06-20",
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  type: "checkout.session.completed",
  data: {
    object: {
      id: sessionId,
      object: "checkout.session",
      payment_status: "paid",
      mode: "payment",
      metadata: {
        userId: process.env.DEMO_USER_ID?.trim() || "demo_user",
        credits: "100",
        packId: "pack_100",
      },
    },
  },
};

const payload = JSON.stringify(event);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_signature_only");
const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

const response = await fetch(`${base}/api/webhooks/stripe`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "stripe-signature": signature,
  },
  body: payload,
});

const text = await response.text();
console.log(`${replay ? "replay" : "deliver"} ${eventId}`);
console.log(response.status, text);
if (!response.ok) process.exit(1);
