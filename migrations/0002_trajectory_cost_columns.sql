-- 0002_trajectory_cost_columns.sql
-- Promote the previously-parsed-from-payload fields to first-class columns
-- on `trajectories` so the Invocations + Spending tabs don't have to JSON
-- parse every row at query time.
--
-- SQLite is permissive about adding NULL-able columns, but D1's migration
-- runner expects deterministic statements — so we declare each ALTER
-- separately and tolerate "duplicate column name" errors on re-run via the
-- `IF NOT EXISTS` simulation pattern below.

-- D1's SQLite doesn't support `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so
-- each migration runs at most once and we just trust the `_cf_KV migrations`
-- bookkeeping table to keep state.

ALTER TABLE trajectories ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trajectories ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trajectories ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trajectories ADD COLUMN status TEXT NOT NULL DEFAULT 'ok';

CREATE INDEX IF NOT EXISTS trajectories_agent_cost
  ON trajectories (agent_id, created_at, cost_cents);
