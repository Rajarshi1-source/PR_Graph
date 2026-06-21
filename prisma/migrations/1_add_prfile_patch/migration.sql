-- AlterTable: add the unified-diff patch column for PR files (feeds the Phase 2 AI analyzer).
ALTER TABLE "pr_files" ADD COLUMN "patch" TEXT;
