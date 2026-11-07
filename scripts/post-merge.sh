#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database changes are applied only through reviewed Supabase migrations.
# Never run Drizzle push automatically after a merge.
