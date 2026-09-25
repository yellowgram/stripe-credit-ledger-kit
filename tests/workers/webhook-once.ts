import { createSqliteDb } from "../../src/billing/db";
import { handleStripeEvent, type StripeEventInput } from "../../src/billing/webhook";

type Input = {
  dbPath: string;
  event: StripeEventInput;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const input = JSON.parse(await readStdin()) as Input;
  const db = createSqliteDb(input.dbPath);
  try {
    const result = await handleStripeEvent(db, input.event);
    process.stdout.write(JSON.stringify(result));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
