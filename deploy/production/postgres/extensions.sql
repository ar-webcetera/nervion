\set ON_ERROR_STOP on
-- Mounted after the existing 4-role / 2-database bootstrap, initial cluster only.
-- Global SQL statistics stay in an administrator-only schema.
\connect nervion_platform
CREATE SCHEMA IF NOT EXISTS monitoring AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA monitoring FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA monitoring;
REVOKE ALL ON ALL TABLES IN SCHEMA monitoring FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA monitoring FROM PUBLIC;

\connect nervion_data_1
CREATE SCHEMA IF NOT EXISTS monitoring AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA monitoring FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA monitoring;
REVOKE ALL ON ALL TABLES IN SCHEMA monitoring FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA monitoring FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
