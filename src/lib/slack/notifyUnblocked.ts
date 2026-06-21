import { prisma } from "@/lib/db/prisma";
import type { GraphDiff } from "@/lib/graph/diffGraphs";
import { open } from "@/lib/crypto/secretbox";
import { postMessage } from "./client";
import { buildUnblockedMessage } from "./formatMessage";

/**
 * Best-effort Slack notification when PRs become unblocked after a merge. A Slack failure
 * must never block a graph update (security-and-api.md §A.4) — all errors are swallowed.
 */
export async function notifyUnblocked(
  repoId: number,
  fullName: string,
  diff: GraphDiff,
): Promise<void> {
  if (diff.newlyUnblocked.length === 0 && diff.removed.length === 0) return;

  try {
    const config = await prisma.slackConfig.findUnique({ where: { repoId } });
    if (!config || !config.isActive || !config.notifyOnUnblock) return;

    const token = open(config.botToken);
    const message = buildUnblockedMessage({ fullName, diff });
    await postMessage(token, config.channelId, message);
  } catch (err) {
    console.warn("[slack] notifyUnblocked failed (non-fatal):", err);
  }
}
