import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Current user + their installations/repos. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return problem(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { installations: { include: { repositories: true } } },
  });
  if (!user) return problem(401, "Session user not found");

  return NextResponse.json({
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    installations: user.installations.map((i) => ({
      id: i.id,
      accountLogin: i.accountLogin,
      accountType: i.accountType,
      repositories: i.repositories.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        isActive: r.isActive,
      })),
    })),
  });
}
