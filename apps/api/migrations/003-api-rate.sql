CREATE TABLE api_rate_limit (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK(count >= 1)
);
