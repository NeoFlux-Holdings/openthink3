-- 0001_initial.sql — bootstrap D1 schema for the deployed agent's shared (per-user) database.
-- Per-thread state lives in the Orchestrator DO's SQLite; this is the slower-moving global store.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,                   -- "drift-wombat"
  owner_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active_model TEXT,
  active_prompt_version INTEGER NOT NULL DEFAULT 1,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'anthropic' | 'openai' | 'cloudflare' | 'aihero' | 'gstack' | 'gbrain' | 'local'
  version TEXT NOT NULL,
  description TEXT,
  when_to_use TEXT,
  tags TEXT,                             -- JSON array
  enabled INTEGER NOT NULL DEFAULT 1,
  has_workflow INTEGER NOT NULL DEFAULT 0,
  r2_skill_md TEXT,                      -- R2 key for SKILL.md
  r2_workflow TEXT,                      -- R2 key for workflow.tsx
  vectorize_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,                -- user_facts | active_work | preferences | domain_knowledge | people
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,
  when_to_use TEXT,
  vectorize_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5 (
  content, when_to_use, content='memories', content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS trajectories (
  turn_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  payload TEXT NOT NULL,                 -- full JSON snapshot, mirrored to R2 if large
  model TEXT NOT NULL,
  score_overall REAL,
  score_schema REAL,
  score_relevancy REAL,
  score_faithfulness REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS trajectories_agent_created
  ON trajectories (agent_id, created_at);

CREATE TABLE IF NOT EXISTS tool_policies (
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scope TEXT NOT NULL,                   -- 'always' | 'session' | 'never'
  arg_pattern TEXT,                      -- optional JSON arg-shape match
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, tool_name, arg_pattern)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'tool_call' | 'approval' | 'spend' | 'sync' | 'pr_back'
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_agent_created
  ON audit_log (agent_id, created_at);

CREATE TABLE IF NOT EXISTS pending_suggestions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'memory' | 'skill' | 'rubric'
  trajectory_turn_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  created_at INTEGER NOT NULL
);
