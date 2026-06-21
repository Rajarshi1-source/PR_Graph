import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** List the connected repos for the current user. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return problem(401, "Not authenticated");

  const repos = await prisma.repository.findMany({
    where: { installation: { userId: session.userId } },
    include: { _count: { select: { pullRequests: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      isActive: r.isActive,
      lastSyncAt: r.lastSyncAt,
      prCount: r._count.pullRequests,
    })),
    page: 1,
    hasNext: false,
  });
}
