import path from "node:path";

import { afterAll, inject } from "vitest";

import { isolateUserHome } from "./vitest.isolated-home";

// No test may touch the developer's real home folder; see vitest.isolated-home.ts.
const isolatedHome = isolateUserHome();
afterAll(() => isolatedHome.restore());

// Test files run in parallel worker processes. A file that opens the database
// without DATABASE_URL gets the ./data/pglite default, and that directory's
// process lock admits one process at a time, so parallel files collide on it.
// Worker slots can be reused while the previous process still holds the DB lock.
// Keep one database per process within each slot; files in that process reuse it.
const poolId = process.env.VITEST_POOL_ID;
if (!process.env.DATABASE_URL && poolId) {
  const dataDir = path.join(
    inject("pgliteRoot"),
    `slot-${poolId}-${process.pid}`,
  );
  process.env.DATABASE_URL = `pglite:${dataDir}`; // guard:allow-env-mutation — Vitest setup runs once per test process, before any test code
}
