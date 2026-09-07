-- The offline SQLite auth importer has been retired. Keep migration 004 immutable.
-- No CASCADE: unexpected dependencies must fail rather than remove unrelated data.
DROP TABLE legacy_auth_receipt;
