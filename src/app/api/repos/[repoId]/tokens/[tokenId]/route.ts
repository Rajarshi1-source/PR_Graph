import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { revokeApiToken } from "@/lib/auth/apiToken";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({
  repoId: z.coerce.number().int().positive(),
  tokenId: z.coerce.number().int().positive(),
});

/** Revoke a token (unknown or already revoked → 404). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ repoId: string; tokenId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid ids");
  const ok = await revokeApiToken(parsed.data.repoId, parsed.data.tokenId, session.userId);
  if (!ok) return problem(404, "Token not found");
  return new Response(null, { status: 204 });
}
