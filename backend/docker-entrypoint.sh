#!/bin/sh
set -e

# Ensure the SQLite data directory exists (mounted volume).
mkdir -p "$(dirname "${DATABASE_URL#file:}")" 2>/dev/null || true

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Seeding products (idempotent)..."
npx prisma db seed

echo "Starting backend..."
exec node dist/server.js
