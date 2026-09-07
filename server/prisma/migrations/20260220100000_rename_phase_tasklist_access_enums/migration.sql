-- Rename PhaseAccess and TaskListAccess enum values from INTERNAL/CLIENT to PRIVATE/PUBLIC.
-- Only runs when the enum still has the old values (idempotent for fresh DBs with PUBLIC/PRIVATE already).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PhaseAccess' AND e.enumlabel = 'INTERNAL'
  ) THEN
    ALTER TYPE "PhaseAccess" RENAME VALUE 'INTERNAL' TO 'PRIVATE';
    ALTER TYPE "PhaseAccess" RENAME VALUE 'CLIENT' TO 'PUBLIC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'TaskListAccess' AND e.enumlabel = 'INTERNAL'
  ) THEN
    ALTER TYPE "TaskListAccess" RENAME VALUE 'INTERNAL' TO 'PRIVATE';
    ALTER TYPE "TaskListAccess" RENAME VALUE 'CLIENT' TO 'PUBLIC';
  END IF;
END $$;
