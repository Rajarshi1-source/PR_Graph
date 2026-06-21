-- AlterTable: persist the Phase 2 AI refinement verdict + explanation on dependency edges.
-- Both are nullable: rows stay null whenever AI_ENABLED=false (deterministic engine only).
ALTER TABLE "dependencies" ADD COLUMN "semantic_verdict" TEXT;
ALTER TABLE "dependencies" ADD COLUMN "explanation" TEXT;
