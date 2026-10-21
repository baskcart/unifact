-- Enforce who may write code_graphs.
-- Run this once as a superuser after the table exists (origin startup creates it).
-- Replace the three role names with the ones on this host. Do not put passwords in this file.
--
--   code_graphs_admin  NOLOGIN role that owns the table
--   unifact_api        login in DATABASE_URL (fact API). SELECT only.
--   code_graphs_writer login in CODE_GRAPHS_DATABASE_URL (release job). SELECT, INSERT, UPDATE.
--
-- Ownership bypasses GRANT, so the API login must not own the table.
--
-- CREATE ROLE code_graphs_admin NOLOGIN;
-- CREATE ROLE unifact_api LOGIN PASSWORD '...';
-- CREATE ROLE code_graphs_writer LOGIN PASSWORD '...';

ALTER TABLE code_graphs OWNER TO code_graphs_admin;
REVOKE ALL ON code_graphs FROM PUBLIC;
REVOKE ALL ON code_graphs FROM unifact_api;
GRANT SELECT ON code_graphs TO unifact_api;
REVOKE ALL ON code_graphs FROM code_graphs_writer;
GRANT SELECT, INSERT, UPDATE ON code_graphs TO code_graphs_writer;
