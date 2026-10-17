import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { createApiToken, listApiTokens, TOKEN_SCOPES } from "@/lib/auth/apiToken";
import { readJsonBody } from "@/lib/http/body";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });
const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(TOKEN_SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** List a repo's API tokens (prefix + metadata only — the secret is never retrievable). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");
  const items = await listApiTokens(parsed.data.repoId, session.userId);
  if (!items) return problem(404, "Repo not connected");
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}

/** Create a token. The plaintext token is in this response ONLY. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");
  const body = await readJsonBody(req, 4_096);
  if (body.error) return body.error;
  const input = CreateBody.safeParse(body.data);
  if (!input.success) return problemFromZod(input.error, "Invalid token request");

  const created = await createApiToken({ userId: session.userId, repoId: parsed.data.repoId, ...input.data });
  if (!created) return problem(404, "Repo not connected");
  return NextResponse.json(created, { status: 201, headers: { "cache-control": "no-store" } });
}
