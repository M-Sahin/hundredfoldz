#!/usr/bin/env node
// Applies every migration in supabase/migrations to a throwaway Postgres (Docker), twice (they must
// be safe to run again), then runs the checks in supabase/tests. Needs Docker; no Supabase account.
//   node scripts/check-migrations.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = `hf-migrations-${process.pid}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

function psql(file) {
  const r = spawnSync("docker", ["exec", "-i", NAME, "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], { input: readFileSync(file), encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(`${file}\n${out}`);
  return out;
}

try {
  docker("run", "-d", "--rm", "--name", NAME, "-e", "POSTGRES_PASSWORD=pw", "postgres:16-alpine");
  // the image starts Postgres once to set it up, then restarts it: wait for the second start
  for (let i = 0; i < 120; i++) {
    const logs = spawnSync("docker", ["logs", NAME], { encoding: "utf8" });
    const ready = `${logs.stdout}${logs.stderr}`.includes("init process complete");
    if (ready && spawnSync("docker", ["exec", NAME, "psql", "-U", "postgres", "-c", "select 1"]).status === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  psql(join(root, "supabase/tests/00_supabase_stub.sql"));
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const pass of [1, 2]) for (const f of migrations) psql(join(root, "supabase/migrations", f));
  console.log(`${migrations.length} migrations applied twice`);
  for (const f of readdirSync(join(root, "supabase/tests")).filter((f) => f.endsWith(".sql") && !f.startsWith("00_")).sort()) {
    const out = psql(join(root, "supabase/tests", f));
    const oks = out.split("\n").filter((l) => /NOTICE:\s+ok/.test(l)).length;
    if (!out.includes("ALL GOOD")) throw new Error(`${f} didn't finish\n${out}`);
    console.log(`${f}: ${oks} checks passed`);
  }
} catch (e) {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", NAME]);
}
