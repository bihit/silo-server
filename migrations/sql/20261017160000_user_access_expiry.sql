-- +goose Up
-- An administrator can give an ordinary account an end date. Once it has
-- passed, the account expiry sweep disables the account through the same
-- guarded path as an administrator's disable, so every sign-in and session
-- check that honours users.enabled also honours the end date. NULL means the
-- account does not expire.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS users_access_expires_at_idx
    ON users (access_expires_at)
    WHERE access_expires_at IS NOT NULL AND enabled;

-- +goose Down
DROP INDEX IF EXISTS users_access_expires_at_idx;
ALTER TABLE users DROP COLUMN IF EXISTS access_expires_at;
