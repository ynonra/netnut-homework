#!/bin/sh
set -e

# Ensure the SQLite data directory exists (mounted volume).
mkdir -p "$(dirname "${DATABASE_URL#file:}")" 2>/dev/null || true

# Multi-instance deployment (issue #7): several backend processes share one SQLite
# file on a named volume. Only ONE of them must run migrations + seed, otherwise
# concurrent `migrate deploy` runs race on the schema. The one-shot `migrate`
# compose service sets RUN_MIGRATIONS=1; the serving replicas leave it unset and
# wait for that service to complete (depends_on: service_completed_successfully).
# Standalone runs (single backend) also set RUN_MIGRATIONS=1 to stay self-contained.
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy

  echo "Seeding products (idempotent)..."
  npx prisma db seed
fi

# A pure migrate/seed one-shot exits after migrating (no server).
if [ "${MIGRATE_ONLY:-0}" = "1" ]; then
  echo "Migrations applied; migrate-only container exiting."
  exit 0
fi

echo "Starting backend..."
exec node dist/server.js
