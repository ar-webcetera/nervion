\set ON_ERROR_STOP on
\getenv data_password NERVION_DATA_PASSWORD
\getenv platform_password NERVION_PLATFORM_PASSWORD
\getenv data_migrator_password NERVION_DATA_MIGRATOR_PASSWORD
\getenv platform_migrator_password NERVION_PLATFORM_MIGRATOR_PASSWORD

-- Initial cluster only. Existing production databases follow docs/saas.md.
CREATE ROLE nervion_data LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'data_password';
CREATE ROLE nervion_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'platform_password';
CREATE ROLE nervion_data_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'data_migrator_password';
CREATE ROLE nervion_platform_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'platform_migrator_password';

CREATE DATABASE nervion_platform OWNER nervion_platform_migrator;
CREATE DATABASE nervion_data_1 OWNER nervion_data_migrator;
REVOKE ALL ON DATABASE nervion_platform FROM PUBLIC;
REVOKE ALL ON DATABASE nervion_data_1 FROM PUBLIC;
GRANT CONNECT ON DATABASE nervion_platform TO nervion_platform;
GRANT CONNECT ON DATABASE nervion_data_1 TO nervion_data;

\connect nervion_platform
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nervion_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE nervion_platform_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nervion_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE nervion_platform_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nervion_platform;

\connect nervion_data_1
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nervion_data;
-- No automatic table grants in the data DB. New tenant tables become accessible
-- only after their migration installs RLS, scoped keys and explicit DML grants.
