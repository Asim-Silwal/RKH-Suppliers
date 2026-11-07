# Deployment guide

## Environments and current gates

- **Local:** Use the React/Vite application with local-only environment values. The Supabase CLI config is checked in, but full local database replay is gated: core baseline DDL is absent from repository migrations and migration history is not reconciled with the connected project.
- **Staging:** No separate staging Supabase project or branch was available during this audit. Provision one before applying or validating database changes. Never use production as staging.
- **Production:** Existing business data is live. No schema change is authorized by this infrastructure setup. Require review, a verified backup, an approved migration, and an explicit production release decision for future schema changes.

## Branch and review flow

Work on feature branches and open a review before merging. The active infrastructure work is isolated on `devops/development-infrastructure`; do not merge or push directly to the production branch. Keep generated dumps, `.env*` secrets, and Supabase local state out of commits. The Replit post-merge hook now installs dependencies only; database schema changes must not run automatically after a merge.

## Migration discipline

Supabase migration files under `supabase/migrations/` are the intended reviewed database change history. Drizzle is present in the repository for a separate database/tooling path, and `DATABASE_URL` alone does not prove it is the Supabase production database. Do not use `drizzle-kit push`, `pnpm --filter db push`, dashboard edits, or ad-hoc SQL as a substitute for reviewed Supabase migrations.

Before migration deployment is enabled for this repo:

1. Reconcile remote schema and migration history; document the baseline for existing core tables without dropping/recreating live data.
2. Review every migration, including the in-progress tenant migration, and identify data/backfill/locking implications.
3. Use an isolated local database after the baseline is complete. Run `supabase db reset` only against that disposable local database and verify the full migration sequence.
4. Deploy the same migration to the dedicated staging project. Inspect `supabase migration list --linked` and confirm the linked ref. Review a remote dry run (`supabase db push --dry-run --linked` where supported by the pinned CLI version) before any apply.
5. Verify RLS isolation using at least two separate business identities, role permissions, financial calculations, existing employee access, and app behavior. Test failure paths as well as successful access.
6. Make and verify a current backup; rehearse restore outside production. Schedule production rollout with an owner-approved maintenance/rollback plan.
7. Apply the reviewed migration once, by one authorized operator, to the verified production project. Monitor errors and audit access afterward. Prefer a forward-fix migration for deployed schema changes; do not assume down migrations can safely restore financial data.

Always inspect CLI help for the pinned version. Explicitly verify project refs before linking or applying. Never use `--project-ref` casually, never run `db reset --remote`, and never allow production credentials in developer machines or client builds.

## CI/CD and secrets

- Store deploy credentials in protected CI secret storage, scoped to the relevant environment and branch approval rules.
- Use only the public publishable/anon key and Supabase URL in browser build variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). RLS must enforce data access.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and database passwords in server-side secret storage only. Service-role access bypasses RLS and must not reach the browser or ordinary developer logs.
- Use separate staging/production secrets. Production migrations should require an authorized environment approval and should not be triggered by arbitrary branch builds.
- Do not add a CI migration deployment job until staging, baseline reconciliation, backup verification, and migration review gates are complete.

## References

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase CLI workflows](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase local and hosted projects](https://supabase.com/docs/guides/local-development/local-and-hosted-projects)
