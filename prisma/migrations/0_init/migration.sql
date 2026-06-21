-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "github_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "avatar_url" TEXT,
    "access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "github_install_id" INTEGER NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" SERIAL NOT NULL,
    "installation_id" INTEGER NOT NULL,
    "github_repo_id" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "github_pr_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author_login" TEXT NOT NULL,
    "author_avatar" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "html_url" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "pr_created_at" TIMESTAMP(3) NOT NULL,
    "pr_updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pr_files" (
    "id" SERIAL NOT NULL,
    "pr_id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pr_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependencies" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "blocker_pr_id" INTEGER NOT NULL,
    "blocked_pr_id" INTEGER NOT NULL,
    "edge_type" TEXT NOT NULL,
    "shared_files" TEXT[],
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_snapshots" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "total_prs" INTEGER NOT NULL,
    "safe_prs" INTEGER NOT NULL,
    "blocked_prs" INTEGER NOT NULL,
    "deadlocked_prs" INTEGER NOT NULL,
    "total_edges" INTEGER NOT NULL,
    "merge_order" JSONB NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "compute_time_ms" INTEGER NOT NULL,
    "graph_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_configs" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "team_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "bot_token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_merge" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_unblock" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "installations_github_install_id_key" ON "installations"("github_install_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_installation_id_github_repo_id_key" ON "repositories"("installation_id", "github_repo_id");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_state_idx" ON "pull_requests"("repo_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repo_id_number_key" ON "pull_requests"("repo_id", "number");

-- CreateIndex
CREATE INDEX "pr_files_pr_id_idx" ON "pr_files"("pr_id");

-- CreateIndex
CREATE INDEX "pr_files_filename_idx" ON "pr_files"("filename");

-- CreateIndex
CREATE INDEX "dependencies_repo_id_idx" ON "dependencies"("repo_id");

-- CreateIndex
CREATE INDEX "dependencies_blocker_pr_id_idx" ON "dependencies"("blocker_pr_id");

-- CreateIndex
CREATE INDEX "dependencies_blocked_pr_id_idx" ON "dependencies"("blocked_pr_id");

-- CreateIndex
CREATE UNIQUE INDEX "dependencies_blocker_pr_id_blocked_pr_id_key" ON "dependencies"("blocker_pr_id", "blocked_pr_id");

-- CreateIndex
CREATE INDEX "graph_snapshots_repo_id_created_at_idx" ON "graph_snapshots"("repo_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "slack_configs_repo_id_key" ON "slack_configs"("repo_id");

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pr_files" ADD CONSTRAINT "pr_files_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_blocker_pr_id_fkey" FOREIGN KEY ("blocker_pr_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_blocked_pr_id_fkey" FOREIGN KEY ("blocked_pr_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_snapshots" ADD CONSTRAINT "graph_snapshots_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_configs" ADD CONSTRAINT "slack_configs_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
