CREATE TABLE legacy_auth_receipt (
  fingerprint text PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now(),
  counts jsonb NOT NULL
);
