CREATE TABLE IF NOT EXISTS commercial_onboarding_workspace (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL DEFAULT 0,
  vendors jsonb NOT NULL,
  drafts jsonb NOT NULL DEFAULT '[]'::jsonb
);
