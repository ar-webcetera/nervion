-- Operator-only query. Never grant the application pg_read_all_stats or
-- pg_monitor: query statistics and filesystem metadata span all tenants.
WITH pending AS (
  SELECT (pg_stat_file('pg_wal/archive_status/' || name, true)).modification AS modified
  FROM pg_ls_dir('pg_wal/archive_status') AS name
  WHERE name LIKE '%.ready'
)
SELECT json_build_object(
  'archivedCount', archived_count,
  'failedCount', failed_count,
  'lastArchivedAt', last_archived_time,
  'lastFailedAt', last_failed_time,
  'unresolvedArchiveFailure', COALESCE(last_failed_time > COALESCE(last_archived_time, '-infinity'::timestamptz), false),
  'pendingWalFiles', (SELECT count(*) FROM pending),
  'oldestPendingWalAgeSeconds', (SELECT COALESCE(EXTRACT(epoch FROM now() - min(modified)), 0) FROM pending),
  'walBytes', (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir())
)
FROM pg_stat_archiver;
