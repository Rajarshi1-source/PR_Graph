import { prisma } from "@/lib/db/prisma";
import { recomputeGraph } from "@/lib/graph/service";

/**
 * Periodic reconciliation sync (plan §5.5 safety net): recompute repos that haven't synced
 * recently, so a dropped/missed webhook doesn't leave a graph permanently stale. Runs in the
 * custom server process alongside the stream worker.
 */
const INTERVAL_MS = 10 * 60_000; // sweep every 10 min
const STALE_MS = 15 * 60_000; // a repo is "stale" 15 min after its last sync
const BATCH = 25;

async function tick(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const repos = await prisma.repository.findMany({
      where: { isActive: true, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: cutoff } }] },
      select: { id: true },
      take: BATCH,
    });
    for (const r of repos) {
      await recomputeGraph({ repoId: r.id, triggeredBy: "reconcile" }).catch((err) =>
        console.warn(`[reconcile] repo ${r.id} failed:`, err),
      );
    }
    if (repos.length) console.log(`[reconcile] swept ${repos.length} stale repo(s)`);
  } catch (err) {
    console.error("[reconcile] tick failed:", err);
  }
}

export function startReconciliation(): NodeJS.Timeout {
  setTimeout(tick, 30_000); // first sweep shortly after boot
  return setInterval(tick, INTERVAL_MS);
}
