import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tsx = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
const dirs: string[] = [];

function run(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsx, path.resolve(script)], { cwd, env });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (out += c));
    child.stderr.on("data", (c: string) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out || `exit ${code}`))));
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("script environment", () => {
  it("lets the process environment win over .env.local, and .env.local win over .env", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-env-"));
    dirs.push(dir);
    const fromEnvFile = path.join(dir, "from-dotenv.sqlite");
    const fromLocal = path.join(dir, "from-local.sqlite");
    const fromProcess = path.join(dir, "from-process.sqlite");
    fs.writeFileSync(path.join(dir, ".env"), `SQLITE_PATH=${fromEnvFile}\nDEMO_USER_ID=dotenv_user\n`);
    fs.writeFileSync(path.join(dir, ".env.local"), `SQLITE_PATH=${fromLocal}\nALLOW_DEMO_CONTROLS=true\n`);
    const base = { PATH: process.env.PATH, HOME: process.env.HOME };

    const explicit = await run("scripts/migrate.ts", dir, { ...base, SQLITE_PATH: fromProcess });
    expect(explicit).toContain("Applied 001_baseline");
    expect(fs.existsSync(fromProcess)).toBe(true);
    expect(fs.existsSync(fromLocal)).toBe(false);

    const files = await run("scripts/migrate.ts", dir, base);
    expect(files).toContain('Demo user "dotenv_user" seeded');
    expect(fs.existsSync(fromLocal)).toBe(true);
    expect(fs.existsSync(fromEnvFile)).toBe(false);
  }, 30_000);
});
