# Development setup

## Repository and environment status

**Confirmed from repository/configuration:** The application is a pnpm workspace; the browser app is `@workspace/mockup-sandbox` (React + Vite). It reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Edge Functions read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from their server environment. The Drizzle config also reads `DATABASE_URL`.

**Confirmed from connected Supabase inventory:** The only available Supabase project is the existing production project. No staging project or Supabase development branch was available during this audit. Do not use that project as a local development target. Create/provision a separate staging project before staging deployments.

**Confirmed from repository:** Supabase CLI was not installed/available when checked. A local `supabase/config.toml` is now checked in, but this does not make the current migration history replayable. The repository has no base schema migrations for core tables and its migration history differs from the connected database. An in-progress tenant migration is present in the worktree and is not approved/applied by this infrastructure task.

**Recommendation:** Treat local Supabase database startup/reset as gated until the existing remote schema is reconciled and a reviewed baseline is established. Never run `supabase db reset` against a remote project. Do not run `db push` or Drizzle `push` against production.

## Prerequisites

- Node.js 24 (matches the current Replit runtime; use the version required by CI if it differs).
- pnpm, matching the lockfile/workspace version.
- Docker Desktop for Supabase local services.
- Supabase CLI, installed using the official instructions and pinned to a team-agreed version.

Install dependencies from the repository root:

```powershell
pnpm install --frozen-lockfile
```

Start the current browser application:

```powershell
Copy-Item artifacts/mockup-sandbox/.env.example artifacts/mockup-sandbox/.env.local
pnpm --filter @workspace/mockup-sandbox run dev
```

Vite serves the application at its printed local URL (normally `http://localhost:5173`). The checked-in example points at the conventional local Supabase URL. The application will not have working backend operations until a safe local or dedicated development Supabase database is available and its public URL/key are populated. The publishable/anon key is intended for browser use; authorization must be enforced by database RLS and server-side checks.

## Local Supabase workflow (after schema baseline is reconciled)

The tracked `supabase/config.toml` is local CLI configuration, not a remote project credential. With Docker and the pinned CLI installed, the standard workflow is:

```powershell
supabase start
supabase status
# Run only after the migration history is known to replay safely:
supabase db reset
supabase stop
```

`db reset` recreates the local database from checked-in migrations and optional seed configuration. It destroys local database state, so keep local data disposable. It must not be used to “fix” the existing remote database. Before enabling this workflow for the repository, add/reconcile the missing base schema, validate every migration against an isolated empty database, and verify the checked-in migration sequence against a staging clone.

## Environment variables and secrets

- `artifacts/mockup-sandbox/.env.example`: safe browser-variable template; copy to `.env.local` and fill local values.
- `VITE_*`: bundled into browser code. Never place passwords, service-role keys, provider tokens, or private credentials in these variables.
- `SUPABASE_SERVICE_ROLE_KEY`: server/Edge Function secret only. Configure through Supabase secrets or a secure CI secret store; never commit it or pass it into Vite.
- `DATABASE_URL`: private server/tooling connection string. Use a local or staging database URL, never production for development. Do not place it in client env files.
- Use separate credentials per environment. Keep real `.env*` files out of Git; this repository ignores them. Rotate any credential that was ever committed or exposed.

## Useful checks

```powershell
pnpm --filter @workspace/mockup-sandbox run typecheck
pnpm --filter @workspace/mockup-sandbox run build
```

These check the frontend bundle only; they do not validate database migrations or RLS. See the deployment guide for migration validation requirements.

## References

- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase local and hosted projects](https://supabase.com/docs/guides/local-development/local-and-hosted-projects)
