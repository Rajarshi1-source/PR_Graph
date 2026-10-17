-- Phase 3 differentiators. Expand-only (every column nullable or defaulted) → zero-downtime.

-- Repo settings (Check Run bot, AI toggle, ignore / workspace globs).
ALTER TABLE "repositories" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- PR refs (stacked PRs, deep merge simulation) + readiness (CI / reviews / mergeable).
ALTER TABLE "pull_requests" ADD COLUMN "head_sha" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "base_sha" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "head_ref" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "base_ref" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "readiness" JSONB;

-- Edge classification (line-level evidence, severity, certainty, regions / symbols).
ALTER TABLE "dependencies" ADD COLUMN "blocking" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "dependencies" ADD COLUMN "severity" TEXT;
ALTER TABLE "dependencies" ADD COLUMN "evidence" TEXT;
ALTER TABLE "dependencies" ADD COLUMN "certainty" TEXT;
ALTER TABLE "dependencies" ADD COLUMN "details" JSONB;

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_runs" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "head_sha" TEXT NOT NULL,
    "check_run_id" BIGINT NOT NULL,
    "summary_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_repo_id_idx" ON "api_tokens"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_runs_repo_id_pr_number_head_sha_key" ON "check_runs"("repo_id", "pr_number", "head_sha");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
