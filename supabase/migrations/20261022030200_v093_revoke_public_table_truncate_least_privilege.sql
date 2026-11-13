-- V0.93 W3 Least Privilege Migration (ANI-1591)
-- Revokes TRUNCATE, TRIGGER, and REFERENCES on all public tables from client roles (anon, authenticated, public).
-- Ensures service_role explicitly retains full administrative capabilities (ALL) across public tables.
-- PostgreSQL Row-Level Security (RLS) does NOT protect against TRUNCATE commands.
-- Ensures that unprivileged client roles cannot truncate tables, attach untrusted triggers,
-- or create foreign key locks across tenant boundaries.

-- 1. Ensure service_role explicitly holds full administrative privileges on all public tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

-- 2. Revoke dangerous non-RLS privileges from existing tables in public schema
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated, public;

-- 3. Alter default privileges so future tables in public schema do not inherit these privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated, public;
