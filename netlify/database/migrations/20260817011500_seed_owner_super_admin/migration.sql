-- Seeds the Owner / Super Admin account for the DCA Pro Manager.
--
-- Why this lives in a migration rather than in application code: the login
-- screen lists whoever is in the `employees` table, and until this row exists
-- there is no owner to sign in as, so there is nobody entitled to create one
-- from inside the app. Migrations run against the production database on
-- deploy, so this is the one place that can put the first owner there.
--
-- What is stored below is a scrypt hash and its salt, not the code itself. The
-- code was drawn from the operating system's random source, is eight digits
-- (the longest the app accepts), was handed over once, and cannot be recovered
-- from these values. `must_change_pin` is true, so the account can do exactly
-- one thing with that code — replace it — before it is any use for anything
-- else. Once replaced, the hash below stops matching anything and the row here
-- is spent.
--
-- Idempotent in both directions: it does nothing if an owner already exists,
-- and nothing if a James Alston row already exists under any role, so a repeat
-- run cannot mint a second owner or overwrite a code the owner has since
-- chosen for themselves.

INSERT INTO "employees" (
  "name",
  "role",
  "active",
  "pin_hash",
  "pin_salt",
  "must_change_pin",
  "pin_updated_at",
  "failed_pin_attempts",
  "created_at"
)
SELECT
  'James Alston',
  'owner',
  true,
  '863216b6943f162ba57d75c1e21cbd7f0302ff78142b1d981c5859e41549eab3',
  'a66b7d8c5fef19d193111bf1dd2b4339',
  true,
  now(),
  0,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "employees" WHERE lower("role") = 'owner'
)
AND NOT EXISTS (
  SELECT 1 FROM "employees" WHERE lower(btrim("name")) = 'james alston'
);

--> statement-breakpoint

-- Record the creation in the audit log the owner will be reading, so the first
-- entry explains where the account came from rather than appearing from
-- nowhere. Skipped if it is already there, and skipped if the insert above
-- found an owner and did nothing.
INSERT INTO "security_events" (
  "event",
  "employee_id",
  "employee_name",
  "employee_role",
  "actor_name",
  "actor_role",
  "detail",
  "outcome",
  "created_at"
)
SELECT
  'account_created',
  e."id",
  e."name",
  e."role",
  'Database migration',
  'system',
  'Owner / Super Admin account seeded with a temporary code that must be replaced at first sign-in',
  'success',
  now()
FROM "employees" e
WHERE lower(btrim(e."name")) = 'james alston'
  AND lower(e."role") = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM "security_events" s
    WHERE s."employee_id" = e."id" AND s."event" = 'account_created'
  );
