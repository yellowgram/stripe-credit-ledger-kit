import { createPostgresDb, createSqliteDb } from "../../src/billing/db";
import { reapExpiredHolds } from "../../src/billing/ledger";

type Input = {
  dbPath?: string;
  databaseUrl?: string;
  now: string;
  ttlSeconds: number;
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
  const db = input.databaseUrl ? createPostgresDb(input.databaseUrl) : createSqliteDb(input.dbPath ?? "");
  try {
    const result = await reapExpiredHolds(db, {
      now: new Date(input.now),
      ttlSeconds: input.ttlSeconds,
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
