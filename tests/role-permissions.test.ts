// Tests for the DCA Pro Manager role system.
//
// Run with:  npm test
//
// These import the same module the API imports, so what is asserted here is the
// rule the server actually applies rather than a restatement of it. Two of them
// read the function and the client source instead, because the point being made
// is about those files: that every route is gated on the server, and that the
// browser's copy of the role list has not drifted from the server's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  ADMIN_PERMISSIONS,
  CREW_ROLES,
  MANAGEMENT_SPECIALIST_PERMISSIONS,
  OWNER_PERMISSIONS,
  ROLE_MANAGEMENT_SPECIALIST,
  ROLE_OWNER,
  TECHNICIAN_PERMISSIONS,
  can,
  canAdministerAccount,
  canManageCrew,
  defaultViewFor,
  navigationFor,
  permissionsFor,
  roleLabel
} from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const API = path.join(repo, "netlify/functions/manager-api.mts");
const CLIENT = path.join(repo, "manager/manager.js");

// ---------------------------------------------------------------------------
// Requirement 4: the owner inherits every Management Specialist permission.
// ---------------------------------------------------------------------------

test("Owner / Super Admin can reach everything a Management Specialist can", () => {
  const owner = permissionsFor(ROLE_OWNER);
  for (const permission of permissionsFor(ROLE_MANAGEMENT_SPECIALIST)) {
    assert.ok(
      owner.includes(permission),
      `the owner is missing the Management Specialist permission "${permission}"`
    );
  }
});

test("the owner also inherits everything admin and technician hold", () => {
  const owner = permissionsFor(ROLE_OWNER);
  for (const permission of [...ADMIN_PERMISSIONS, ...TECHNICIAN_PERMISSIONS]) {
    assert.ok(owner.includes(permission), `the owner is missing "${permission}"`);
  }
});

test("the owner keeps the controls that are the owner's alone", () => {
  for (const permission of ["crew", "charges", "security_log"] as const) {
    assert.ok(can(ROLE_OWNER, permission), `the owner is missing "${permission}"`);
  }
  assert.ok(canManageCrew(ROLE_OWNER));
});

test("widening the Management Specialist widens the owner in the same edit", () => {
  // The owner set is computed from the others rather than typed out, which is
  // what makes the inheritance above impossible to forget. If this ever becomes
  // a hand-maintained list, this test is the one that will notice.
  const owner = new Set(OWNER_PERMISSIONS);
  for (const permission of MANAGEMENT_SPECIALIST_PERMISSIONS) {
    assert.ok(owner.has(permission));
  }
});

// ---------------------------------------------------------------------------
// Requirement 1: the role can be handed out from the crew screen.
// ---------------------------------------------------------------------------

test("Management Specialist is a role the crew screen can offer", () => {
  assert.ok(CREW_ROLES.includes(ROLE_MANAGEMENT_SPECIALIST));
  assert.equal(roleLabel(ROLE_MANAGEMENT_SPECIALIST), "Management Specialist");
});

test("the owner may choose Management Specialist in the Add crew member dropdown", () => {
  // The dropdown is built from the role list the crew endpoint sends, and each
  // entry carries whether this account may hand that role out.
  assert.ok(canAdministerAccount(ROLE_OWNER, ROLE_MANAGEMENT_SPECIALIST));
  for (const role of ["admin", "manager", "technician", ROLE_MANAGEMENT_SPECIALIST]) {
    assert.ok(
      !canAdministerAccount(role, ROLE_MANAGEMENT_SPECIALIST),
      `${role} must not be offered Management Specialist in the dropdown`
    );
  }
});

test("the browser's role list has not drifted from the server's", () => {
  const client = readFileSync(CLIENT, "utf8");
  const roles = client.match(/var CREW_ROLES = \[[^\]]*\]/);
  assert.ok(roles, "manager.js has no CREW_ROLES list");
  for (const role of CREW_ROLES) {
    assert.ok(roles[0].includes(`"${role}"`), `manager.js is missing the ${role} role`);
  }
});

// ---------------------------------------------------------------------------
// Requirement 2: what a Management Specialist reaches.
// ---------------------------------------------------------------------------

test("a Management Specialist reaches the commercial side of the business", () => {
  for (const permission of [
    "customers", // the customer database
    "customer_contacts", // contact information
    "leads", // requests coming in
    "marketing", // marketing and promotions
    "jobs", // jobs
    "schedule", // scheduling
    "dashboard", // operational management information
    "reports", // approved sales and management reports
    "followups", // customer follow-up tools
    "book" // booking and appointment management
  ] as const) {
    assert.ok(
      can(ROLE_MANAGEMENT_SPECIALIST, permission),
      `a Management Specialist should reach "${permission}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Requirement 3: what a Management Specialist must not reach.
// ---------------------------------------------------------------------------

test("a Management Specialist holds no security control", () => {
  // No crew list, so no creating accounts, no changing anybody's role and no
  // issuing or resetting a login code. No audit log either.
  assert.ok(!can(ROLE_MANAGEMENT_SPECIALIST, "crew"));
  assert.ok(!can(ROLE_MANAGEMENT_SPECIALIST, "security_log"));
  assert.ok(!canManageCrew(ROLE_MANAGEMENT_SPECIALIST));
  for (const target of CREW_ROLES) {
    assert.ok(
      !canAdministerAccount(ROLE_MANAGEMENT_SPECIALIST, target),
      `a Management Specialist must not administer a ${target} account`
    );
  }
});

test("a Management Specialist cannot create or change an owner", () => {
  assert.ok(!canAdministerAccount(ROLE_MANAGEMENT_SPECIALIST, ROLE_OWNER));
});

// ---------------------------------------------------------------------------
// Requirements 5 and 6: what an admin keeps and what an admin loses.
// ---------------------------------------------------------------------------

test("an admin cannot reach the customer database or contact list", () => {
  for (const role of ["admin", "manager"]) {
    assert.ok(!can(role, "customers"), `${role} reaches the customer database`);
    assert.ok(!can(role, "customer_contacts"), `${role} reaches the contact list`);
    // The lead queue is a contact list under another name: every row on it is
    // somebody's name and phone number.
    assert.ok(!can(role, "leads"), `${role} reaches the request queue`);
    assert.ok(!can(role, "imports"), `${role} reaches bulk customer import`);
  }
});

test("an admin cannot reach sales trends or sensitive reporting", () => {
  for (const role of ["admin", "manager"]) {
    assert.ok(!can(role, "reports"), `${role} reaches sales and financial reporting`);
  }
});

test("an admin cannot reach owner or Management Specialist security controls", () => {
  for (const role of ["admin", "manager"]) {
    assert.ok(!can(role, "security_log"));
    assert.ok(!canAdministerAccount(role, ROLE_OWNER));
    assert.ok(!canAdministerAccount(role, ROLE_MANAGEMENT_SPECIALIST));
  }
});

test("an admin keeps the operational work the office runs on", () => {
  for (const role of ["admin", "manager"]) {
    for (const permission of [
      "charges", // process invoices, take payments
      "jobs",
      "schedule",
      "routing", // maps and routing
      "book", // basic service request functions
      "dashboard"
    ] as const) {
      assert.ok(can(role, permission), `${role} lost "${permission}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Requirement 7: technicians get field work and nothing else.
// ---------------------------------------------------------------------------

test("a technician reaches only field and job functions", () => {
  assert.deepEqual(permissionsFor("technician").slice().sort(), [
    "jobs",
    "routing",
    "schedule"
  ]);
});

test("a technician cannot reach management data", () => {
  for (const permission of [
    "customers",
    "customer_contacts",
    "leads",
    "marketing",
    "reports",
    "dashboard",
    "followups",
    "imports",
    "charges",
    "crew",
    "security_log"
  ] as const) {
    assert.ok(!can("technician", permission), `a technician reaches "${permission}"`);
  }
});

test("an unrecognised role gets the technician set, never a generous default", () => {
  assert.deepEqual(permissionsFor("chief_wizard"), permissionsFor("technician"));
  assert.ok(!canManageCrew("chief_wizard"));
});

// ---------------------------------------------------------------------------
// Requirement 9: navigation follows the same table.
// ---------------------------------------------------------------------------

test("each role is only offered the sections it may open", () => {
  assert.deepEqual(navigationFor(ROLE_OWNER), [
    "dashboard",
    "book",
    "leads",
    "jobs",
    "customers",
    "charges",
    "crew"
  ]);
  assert.deepEqual(navigationFor(ROLE_MANAGEMENT_SPECIALIST), [
    "dashboard",
    "book",
    "leads",
    "jobs",
    "customers"
  ]);
  assert.deepEqual(navigationFor("admin"), ["dashboard", "book", "jobs", "charges", "crew"]);
  assert.deepEqual(navigationFor("technician"), ["jobs"]);
});

test("everyone lands on a section they can actually open", () => {
  for (const role of CREW_ROLES) {
    const landing = defaultViewFor(role);
    assert.ok(
      navigationFor(role).includes(landing),
      `${role} lands on "${landing}", which they cannot open`
    );
  }
});

// ---------------------------------------------------------------------------
// Requirement 8: the server, not the screen, is what enforces this.
// ---------------------------------------------------------------------------

test("every data route in the API is gated on the server", () => {
  const api = readFileSync(API, "utf8");
  // Each of these routes reads or writes something a role can be shut out of.
  // The check is that a permission test appears within the route's own body,
  // so a request typed by hand against a route whose tab was never drawn is
  // still refused.
  const gated: [string, RegExp][] = [
    ["dashboard", /path === "dashboard" && method === "GET"\) \{\s*\n\s*if \(!allows\("dashboard"\)\)/],
    ["customers", /path === "customers" && method === "GET"\)[\s\S]{0,400}?if \(!allows\("customers"\)\)/],
    ["customers/import", /path === "customers\/import" && method === "POST"\) \{\s*\n\s*if \(!allows\("imports"\)\)/],
    ["schedule", /path === "schedule" && method === "GET"\) \{\s*\n\s*if \(!allows\("schedule"\)\)/],
    ["jobs GET", /path === "jobs" && method === "GET"\) \{\s*\n\s*if \(!allows\("jobs"\)\)/],
    ["jobs POST", /path === "jobs" && method === "POST"\) \{\s*\n\s*if \(!allows\("book"\)\)/],
    ["leads", /path === "leads" && method === "GET"\) \{\s*\n\s*if \(!allows\("leads"\)\)/],
    ["custom-charges", /path === "custom-charges" && method === "GET"\) \{\s*\n\s*if \(!allows\("charges"\)\)/],
    ["security-log", /path === "security-log" && method === "GET"\) \{\s*\n\s*if \(!allows\("security_log"\)\)/]
  ];
  for (const [name, pattern] of gated) {
    assert.match(api, pattern, `the ${name} route is not gated on the server`);
  }
});

test("permissions are read from the stored role, never from the request", () => {
  const api = readFileSync(API, "utf8");
  // `allows` closes over the account row re-read from the database on every
  // request, so nothing the browser sends can widen a session.
  assert.match(api, /const allows = \(permission: Permission\) => can\(account\.role, permission\)/);
});

test("a technician's job queries are narrowed in SQL, not in the response", () => {
  const api = readFileSync(API, "utf8");
  assert.match(api, /const ownJobsOnly = !allows\("dashboard"\)/);
  // The filter is passed to the query rather than applied to the rows after
  // they come back, so somebody else's work is never read out of the database.
  assert.match(api, /ownJobsOnly \? eq\(jobs\.assignedTo, account\.id\) : undefined/);
});

test("the client asks the server what it may see rather than deciding for itself", () => {
  const client = readFileSync(CLIENT, "utf8");
  assert.match(client, /state\.permissions = d\.employee\.permissions \|\| \[\]/);
  assert.match(client, /state\.navigation = d\.employee\.navigation \|\| \[\]/);
  // And forgets it again at sign-out, so no screen built for one account is
  // left standing in front of the next.
  assert.match(client, /state\.permissions = \[\];\s*\n\s*state\.navigation = \[\];/);
});
