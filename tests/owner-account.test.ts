// Tests for the Owner / Super Admin account.
//
// Run with:  npm test
//
// The authorisation tests import the real modules the API imports, so they test
// the rules the server actually applies rather than a copy of them. The two
// tests that need live data — is the owner in the login list, does the
// temporary code open the account — talk to the database branch the site is
// pointed at and skip when there is nothing to talk to, so the suite is still
// useful on a laptop with no connection string.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { verifyPin } from "../lib/manager-pin.ts";
import {
  CREW_ROLES,
  ROLE_MANAGEMENT_SPECIALIST,
  ROLE_OWNER,
  canAdministerAccount,
  canManageCrew,
  isOwner,
  permissionsFor,
  roleLabel
} from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const SEED_SQL = path.join(
  repo,
  "netlify/database/migrations/20260817011500_seed_owner_super_admin/migration.sql"
);

const OWNER_NAME = "James Alston";

// ---------------------------------------------------------------------------
// The seed migration — what actually puts the owner in the production database.
// ---------------------------------------------------------------------------

test("the seed migration creates James Alston as an owner", () => {
  const sql = readFileSync(SEED_SQL, "utf8");
  assert.match(sql, /INSERT INTO "employees"/);
  assert.match(sql, /'James Alston'/);
  assert.match(sql, /'owner'/);
});

test("the seeded owner starts on a temporary code it must replace", () => {
  const sql = readFileSync(SEED_SQL, "utf8");
  // must_change_pin is what stops a handed-over code from being usable for
  // anything except choosing a new one.
  assert.match(sql, /"must_change_pin"/);
  assert.match(sql, /"pin_hash"/);
  assert.match(sql, /"pin_salt"/);
});

test("the seed migration cannot mint a second owner if it runs again", () => {
  const sql = readFileSync(SEED_SQL, "utf8");
  assert.match(sql, /NOT EXISTS[\s\S]*lower\("role"\) = 'owner'/);
  assert.match(sql, /NOT EXISTS[\s\S]*lower\(btrim\("name"\)\) = 'james alston'/);
});

test("the migration stores a hash, never the code itself", () => {
  const sql = readFileSync(SEED_SQL, "utf8");
  // The two hex literals are the scrypt hash (64 chars) and its salt (32).
  // Anything that looks like a bare PIN — a short run of digits in quotes —
  // would mean the code was written down where it can be read back.
  const quoted = sql.match(/'([^']*)'/g) || [];
  for (const raw of quoted) {
    const value = raw.slice(1, -1);
    if (/^\d{3,10}$/.test(value)) {
      assert.fail(`migration contains what looks like a PIN: ${value.length} digits`);
    }
  }
});

// ---------------------------------------------------------------------------
// Requirement 11: the code must never reach the browser.
// ---------------------------------------------------------------------------

test("no login code is present in the client-side app", () => {
  for (const file of ["manager/manager.js", "manager/index.html", "manager/setup/setup.js"]) {
    const source = readFileSync(path.join(repo, file), "utf8");
    assert.ok(
      !/863216b6943f162ba57d75c1e21cbd7f0302ff78142b1d981c5859e41549eab3/.test(source),
      `${file} contains the owner PIN hash`
    );
    assert.ok(
      !/a66b7d8c5fef19d193111bf1dd2b4339/.test(source),
      `${file} contains the owner PIN salt`
    );
  }
});

// ---------------------------------------------------------------------------
// What the owner role is allowed to do — the rules the API enforces.
// ---------------------------------------------------------------------------

test("owner is a known crew role and reads as Owner / Super Admin on screen", () => {
  assert.ok(CREW_ROLES.includes(ROLE_OWNER));
  assert.equal(roleLabel("owner"), "Owner / Super Admin");
  assert.ok(isOwner("owner"));
  assert.ok(isOwner("  Owner  "));
  assert.ok(!isOwner("admin"));
});

test("the login screen and the app agree on what a role is called", () => {
  // The dropdown falls back to its own copy of the labels when a response does
  // not carry one, so the two lists have to stay in step.
  const client = readFileSync(path.join(repo, "manager/manager.js"), "utf8");
  const block = client.match(/var ROLE_LABELS = \{[\s\S]*?\};/);
  assert.ok(block, "manager.js has no ROLE_LABELS block");
  for (const role of CREW_ROLES) {
    assert.ok(
      block[0].includes(`${role}: "${roleLabel(role)}"`),
      `manager.js calls ${role} something other than "${roleLabel(role)}"`
    );
  }
});

test("owner reaches every part of the app, including the security log", () => {
  const owner = permissionsFor("owner");
  for (const area of [
    "dashboard", // sales trends, business reports
    "book",
    "leads",
    "jobs",
    "customers", // customer database
    "crew", // employee management
    "charges", // invoices and payments
    "imports", // customer imports, Clover
    "security_log" // security / audit log
  ]) {
    assert.ok(owner.includes(area), `owner is missing ${area}`);
  }
  assert.ok(canManageCrew("owner"));
});

test("owner may create, change, disable and reset a Management Specialist", () => {
  assert.ok(canAdministerAccount("owner", ROLE_MANAGEMENT_SPECIALIST));
});

test("owner may administer another owner; nobody else may", () => {
  assert.ok(canAdministerAccount("owner", "owner"));
  for (const role of ["admin", "manager", ROLE_MANAGEMENT_SPECIALIST, "technician"]) {
    assert.ok(
      !canAdministerAccount(role, "owner"),
      `${role} must not be able to administer an owner`
    );
  }
});

test("admin and manager are shut out of Management Specialist accounts", () => {
  for (const role of ["admin", "manager", ROLE_MANAGEMENT_SPECIALIST, "technician"]) {
    assert.ok(
      !canAdministerAccount(role, ROLE_MANAGEMENT_SPECIALIST),
      `${role} must not be able to administer a Management Specialist`
    );
  }
});

test("only the owner holds the security log", () => {
  for (const role of ["admin", "manager", ROLE_MANAGEMENT_SPECIALIST, "technician"]) {
    assert.ok(
      !permissionsFor(role).includes("security_log"),
      `${role} must not reach the security log`
    );
  }
});

test("existing role restrictions are unchanged by adding the owner", () => {
  // A Management Specialist keeps the office floor and nothing more, and a
  // technician keeps the field set. Adding an owner must not have widened
  // either, and must not have widened admin or manager beyond what they had.
  assert.deepEqual(permissionsFor(ROLE_MANAGEMENT_SPECIALIST).sort(), [
    "book",
    "customers",
    "dashboard",
    "jobs",
    "leads"
  ]);
  assert.deepEqual(permissionsFor("technician").sort(), [
    "book",
    "customers",
    "dashboard",
    "jobs",
    "leads"
  ]);
  for (const role of ["admin", "manager"]) {
    assert.ok(!permissionsFor(role).includes("security_log"));
    assert.ok(!canAdministerAccount(role, ROLE_MANAGEMENT_SPECIALIST));
  }
});

test("an unknown role gets the narrowest set, not the widest", () => {
  const unknown = permissionsFor("chief_wizard");
  assert.ok(!unknown.includes("crew"));
  assert.ok(!unknown.includes("security_log"));
  assert.ok(!canManageCrew("chief_wizard"));
  assert.ok(!canAdministerAccount("chief_wizard", ROLE_MANAGEMENT_SPECIALIST));
});

// ---------------------------------------------------------------------------
// Owner authentication, checked against the credential the migration seeds
// without needing a database. Supply the code that was handed over once:
//
//   OWNER_TEMP_PIN=… npm test
//
// The code is deliberately not written down anywhere in this repository, so
// this test skips rather than fails when it is not supplied.
// ---------------------------------------------------------------------------

function seededCredential(): { hash: string; salt: string } {
  const sql = readFileSync(SEED_SQL, "utf8");
  const hash = sql.match(/'([0-9a-f]{64})'/);
  const salt = sql.match(/'([0-9a-f]{32})'/);
  assert.ok(hash && salt, "the seed migration is missing its hash and salt");
  return { hash: hash[1], salt: salt[1] };
}

test("the seeded credential is a full-length scrypt hash and salt", () => {
  const { hash, salt } = seededCredential();
  assert.equal(hash.length, 64);
  assert.equal(salt.length, 32);
  assert.notEqual(hash, salt);
});

test("the owner's temporary code authenticates against the seeded hash", (t) => {
  const pin = (process.env.OWNER_TEMP_PIN || "").trim();
  if (!pin) return t.skip("set OWNER_TEMP_PIN to check the temporary code");
  const { hash, salt } = seededCredential();

  assert.ok(verifyPin(pin, hash, salt), "the temporary code was refused");
  // A near miss must not open it, which is what proves the check above is the
  // hash doing the work rather than something answering true for anything.
  const nearMiss = pin.slice(0, -1) + String((Number(pin.slice(-1)) + 1) % 10);
  assert.ok(!verifyPin(nearMiss, hash, salt), "a wrong code was accepted");
  assert.ok(!verifyPin("", hash, salt));
});

// ---------------------------------------------------------------------------
// Live data, against the database branch the site is pointed at.
//
// Run after the deploy that applies the seed migration:
//
//   CHECK_LIVE_OWNER=1 npm test
//
// Opt-in rather than automatic, because before that deploy the row genuinely is
// not there yet and a red suite would be saying nothing useful.
// ---------------------------------------------------------------------------

async function connect() {
  if (!process.env.NETLIFY_DB_URL && !process.env.NETLIFY_DATABASE_URL) return null;
  try {
    const { getDatabase } = await import("@netlify/database");
    const { sql } = await getDatabase();
    return sql;
  } catch {
    return null;
  }
}

const liveCheck = process.env.CHECK_LIVE_OWNER ? test : test.skip;

liveCheck("James Alston — Owner appears in the crew login list", async (t) => {
  const sql = await connect();
  if (!sql) return t.skip("no database connection configured");

  // The same query the login screen's GET runs: active crew, names and roles
  // only, in name order.
  const rows = await sql`
    select id, name, role from employees where active = true order by name
  `;
  const owner = rows.find((r) => String(r.name).trim() === OWNER_NAME);
  assert.ok(
    owner,
    `${OWNER_NAME} is not in the login list — has the seed migration been deployed?`
  );
  assert.equal(String(owner.role).toLowerCase(), "owner");
  assert.equal(roleLabel(owner.role), "Owner / Super Admin");
});

liveCheck("exactly one owner exists, and no existing account was promoted", async (t) => {
  const sql = await connect();
  if (!sql) return t.skip("no database connection configured");

  const owners = await sql`select name from employees where lower(role) = 'owner'`;
  assert.equal(owners.length, 1, "there should be exactly one owner");
  assert.equal(String(owners[0].name).trim(), OWNER_NAME);
});

liveCheck("the live owner row is active and on a temporary code", async (t) => {
  const sql = await connect();
  if (!sql) return t.skip("no database connection configured");

  const [row] = await sql`
    select active, must_change_pin, pin_hash is not null as has_code
    from employees
    where lower(btrim(name)) = ${OWNER_NAME.toLowerCase()} and lower(role) = 'owner'
  `;
  assert.ok(row, `${OWNER_NAME} has no owner row yet`);
  assert.equal(row.active, true);
  assert.equal(row.has_code, true);
  // Turns false the moment the owner chooses their own code, so a failure here
  // after first sign-in is the expected reading rather than a problem.
  assert.equal(row.must_change_pin, true);
});
