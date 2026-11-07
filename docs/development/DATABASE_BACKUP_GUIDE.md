# Database backup and restoration guide

## Current state

**Confirmed from repository:** No database backup/restore scripts or documented restore procedure were found. The repository uses Supabase and also has a Drizzle configuration requiring `DATABASE_URL`; this guide does not assume those represent the same managed database.

**Confirmed from connected project inventory:** The available Supabase organization was on the Free plan when checked. Supabase documents that Free projects do not receive automatic database backups. Confirm the current plan and dashboard backup status with the project owner because plan features can change.

**Recommendation:** Treat production recovery as unproven until a backup is exported to secure offsite storage and successfully restored to an isolated project. This task does not create a backup or touch production data.

## Backup policy to establish

1. Name a backup owner and schedule (at minimum before every production schema release; choose a recurring interval based on acceptable data loss).
2. Export to encrypted storage outside Git and outside the application host. Restrict access to designated operators; use retention and deletion rules appropriate to financial records.
3. Record project, timestamp (UTC), CLI version, migration version, export types, and restore-test result without recording secrets in the repository.
4. Test restores periodically in a separate project. Confirm row counts, representative balances, auth access, and required storage objects.
5. For stronger recovery objectives, evaluate a paid plan/PITR and managed backups; verify retention and restore-point guarantees for the chosen plan.

## Logical export using Supabase CLI

Use a currently supported, team-pinned Supabase CLI and authenticate as an authorized operator. Keep the database password out of shell history, command arguments, CI logs, and documentation. Run from a secured machine and store outputs only in the approved encrypted backup location.

For a linked project, first inspect the linked project ref and ensure it is the intended target. Then create separate exports:

```powershell
supabase link --project-ref <PROJECT_REF>
supabase db dump --linked --file <SECURE_BACKUP_DIR>/schema.sql
supabase db dump --linked --role-only --file <SECURE_BACKUP_DIR>/roles.sql
supabase db dump --linked --data-only --use-copy --file <SECURE_BACKUP_DIR>/data.sql
```

The role-only export is for recovery planning and can contain sensitive role definitions; store it as a secret. Review the current CLI help for version-specific options. Do not commit any dump. Avoid `--debug` in shared logs.

**Important coverage limits:** Supabase `db dump` excludes managed schemas (including `auth` and `storage`) by default. A normal logical dump is not a full platform backup. Database dumps do not include the bytes of objects stored through Supabase Storage. Plan and verify recovery for Auth identities and Storage object bytes separately using supported platform migration/export processes. Do not assume copying Storage metadata rows restores the objects. A dump may include customer financial data and must be handled as highly sensitive.

## Restore rehearsal

Restore only into a new, isolated, non-production Supabase project first. Keep application traffic and integrations disabled during the rehearsal. Use the matching CLI/PostgreSQL compatibility and follow the current official Supabase backup/restore procedure; restore roles/schema/data in the documented order, then separately recover supported Auth and Storage contents. Validate RLS, user access, financial totals against pre-backup evidence, and application behavior. Record the outcome.

Never run a restore against the live production project as a test. A production recovery is an incident procedure: identify the exact target, preserve current state where feasible, communicate expected downtime, obtain the business owner’s authorization, and follow the supported Supabase restore procedure. Restoring can replace current database state. Do not improvise destructive SQL or target a linked project without verifying its ref.

## References

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Free plan backup FAQ](https://supabase.com/kb/faqs/platform/free-plan-backups)
- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Backup and restore between Supabase projects](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
