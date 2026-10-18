#!/usr/bin/env bash
# Real service+SQL journey: drives the staged Steward domain services
# through psql-backed repositories against THIS disposable database, so
# SQL↔TS mapping defects cannot hide behind in-memory fakes. The provider
# is fake; no model is called. $1 is the harness connection string.
set -euo pipefail

export STEWARD_JOURNEY_DB="$1"
cd "$(dirname "$0")/../../../.."
bunx vitest run src/lib/steward-journey.sql.test.ts
