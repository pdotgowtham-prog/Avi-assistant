import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync("index.html", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261104110630_avi_memory_operation_request_fingerprint.sql",
  "utf8",
);

// Compile every inline script without executing browser-dependent code.
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length > 0, "index.html must contain application scripts");
scripts.forEach((match, index) => {
  new vm.Script(match[1], { filename: `index.html:inline-script-${index + 1}` });
});

// Guard the key Phase 4A invariants against accidental regressions.
assert.match(html, /rpc\(["']avi_apply_memory_operation["']/,
  "Signed-in memory mutations must use the revisioned RPC");
assert.match(html, /function aviMemoryQueueKey\(userId\)\s*\{[^}]*userId/s,
  "Offline operations must be scoped to the signed-in account");
assert.match(html, /navigator\.locks\.request\(["']avi-memory-queue-/,
  "Concurrent tabs must coordinate queue flushes when Web Locks are available");
assert.match(html, /addEventListener\(["']storage["']/,
  "Other tabs must notice changes to the shared account queue");
assert.match(html, /is\(["']deleted_at["'],\s*null\)/,
  "Cloud refresh must exclude tombstoned memories");
assert.doesNotMatch(
  html,
  /\.from\(["']avi_personal_memories["']\)\s*\.\s*(insert|update|delete)\s*\(/i,
  "The browser must not mutate memory rows directly",
);
assert.doesNotMatch(html, /service_role/i,
  "The browser must never contain a Supabase service-role key");

assert.match(migration, /auth\.uid\(\)/,
  "The RPC must derive ownership from the authenticated JWT");
assert.match(migration, /security definer/i,
  "The RPC must run with its controlled owner privileges");
assert.match(migration, /set search_path\s*=\s*''/i,
  "The SECURITY DEFINER function must use a fixed empty search_path");
assert.match(migration, /v_existing_request\s*<>\s*v_request/i,
  "An idempotency key must be bound to its original request payload");
assert.match(migration, /revision\s*=\s*revision\s*\+\s*1/i,
  "Mutations must increment the memory revision");
assert.match(migration, /deleted_at\s*=\s*now\(\)/i,
  "Deletion must create a tombstone rather than physically deleting a memory");
assert.match(migration, /revoke insert, update, delete on table public\.avi_personal_memories from anon, authenticated/i,
  "Direct authenticated table mutations must be revoked");

console.log(`AVI Phase 4A checks passed: ${scripts.length} inline scripts parsed and memory invariants verified.`);
