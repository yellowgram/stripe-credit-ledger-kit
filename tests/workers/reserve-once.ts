import { createSqliteDb } from "../../src/billing/db";
import { reserve } from "../../src/billing/ledger";

type Input = {
  dbPath: string;
  userId: string;
  amount: number;
  idempotencyKey: string;
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
    const result = await reserve(db, {
      userId: input.userId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    process.stdout.write(JSON.stringify(result));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
