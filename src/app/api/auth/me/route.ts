import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Current user + their installations/repos. */
export async function GET(req: NextRequest) {
  const { session, error } = requireSession(req);
  if (error) return error;

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
