-- 0003_memories_tags.sql
-- Add an explicit `tags` column to memories so users can curate a
-- taxonomy of category-style chips alongside the existing free-form
-- `when_to_use` field (which the Learning UI already tokenizes into
-- inferred topic chips). Explicit tags give the user a CRUD'd grouping
-- that round-trips through bulk export/import without depending on
-- text-tokenizer heuristics.
--
-- Stored as a JSON-encoded string (e.g. `["work","preferences"]`) to
-- keep the schema portable — D1 is full SQLite so we don't get the
-- ARRAY type modern Postgres ships. A NULL value means "no tags";
-- empty arrays should be normalized to NULL on write so a SELECT can
-- short-circuit on `tags IS NOT NULL`.
--
-- Mirrors the worker `sanitizeTag()` helper added in the knowledge
-- route: lowercase, alphanum + hyphens, max 24 chars, max 12 per memory.

ALTER TABLE memories ADD COLUMN tags TEXT;
