import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { redis } from "@/lib/cache/redis";
import { problem } from "@/lib/http/problem";

export const TOKEN_SCOPES = ["preflight:read", "graph:read"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const PREFIX = "prg_";
const BODY_LENGTH = 32;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const TOKEN_RATE_LIMIT_PER_MIN = 60;

/** `prg_` + 32 base62 chars from a CSPRNG (rejection sampling — no modulo bias). */
export function generateToken(): string {
  let out = "";
  while (out.length < BODY_LENGTH) {
    for (const b of crypto.randomBytes(48)) {
      if (b < 248) out += ALPHABET[b % 62]; // 248 = 4 × 62 → unbiased
      if (out.length === BODY_LENGTH) break;
    }
  }
  return PREFIX + out;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const isTokenShaped = (s: string) => new RegExp(`^${PREFIX}[0-9A-Za-z]{${BODY_LENGTH}}$`).test(s);

export interface TokenPrincipal {
  id: number;
  userId: number;
  repoId: number;
  fullName: string;
  scopes: string[];
}

/**
 * Bearer-token guard for `/api/v1/**` (security-and-api.md §A.9): parse `Authorization: Bearer
 * prg_…`, look up by sha256 (the plaintext is never stored), check revocation / expiry / scope and
 * that the creating user still owns the repo, then apply the per-token rate limit.
 */
export async function requireApiToken(
  req: NextRequest,
  scope: TokenScope,
): Promise<{ token: TokenPrincipal; error: null } | { token: null; error: NextResponse }> {
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw || !isTokenShaped(raw)) {
    return { token: null, error: problem(401, "Missing or malformed API token", { hint: "Authorization: Bearer prg_…" }) };
  }

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { repository: { select: { fullName: true, installation: { select: { userId: true } } } } },
  });
  const now = Date.now();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now)) {
    return { token: null, error: problem(401, "Invalid, revoked or expired API token") };
  }
  if (row.repository.installation.userId !== row.userId) {
    return { token: null, error: problem(401, "Token owner no longer has access to this repository") };
  }
  if (!row.scopes.includes(scope)) {
    return { token: null, error: problem(403, `Token lacks the ${scope} scope`) };
  }

  const limited = await rateLimited(row.id).catch(() => null);
  if (limited) return { token: null, error: limited };

  // Best-effort usage stamp (never blocks the request).
  prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return {
    token: { id: row.id, userId: row.userId, repoId: row.repoId, fullName: row.repository.fullName, scopes: row.scopes },
    error: null,
  };
}

/** Fixed window per token per minute → 429 with Retry-After. */
async function rateLimited(tokenId: number): Promise<NextResponse | null> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:tok:${tokenId}:${minute}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 70);
  if (count <= TOKEN_RATE_LIMIT_PER_MIN) return null;
  const retryAfter = 60 - Math.floor((Date.now() / 1000) % 60);
  const res = problem(429, `Rate limit of ${TOKEN_RATE_LIMIT_PER_MIN} requests/minute exceeded`);
  res.headers.set("retry-after", String(retryAfter));
  return res;
}

export interface TokenView {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const VIEW = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/** Create a token for a repo the user owns. Returns the plaintext ONCE, or null if not owned. */
export async function createApiToken(input: {
  userId: number;
  repoId: number;
  name: string;
  scopes: TokenScope[];
  expiresInDays?: number;
}): Promise<{ token: string; view: TokenView } | null> {
  const repo = await prisma.repository.findFirst({
    where: { id: input.repoId, installation: { userId: input.userId } },
    select: { id: true },
  });
  if (!repo) return null;
  const token = generateToken();
  const view = await prisma.apiToken.create({
    data: {
      userId: input.userId,
      repoId: input.repoId,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, PREFIX.length + 4),
      scopes: [...new Set(input.scopes)].sort(),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
    },
    select: VIEW,
  });
  return { token, view };
}

export async function listApiTokens(repoId: number, userId: number): Promise<TokenView[] | null> {
  const repo = await prisma.repository.findFirst({ where: { id: repoId, installation: { userId } }, select: { id: true } });
  if (!repo) return null;
  return prisma.apiToken.findMany({ where: { repoId }, orderBy: { createdAt: "desc" }, select: VIEW });
}

export async function revokeApiToken(repoId: number, tokenId: number, userId: number): Promise<boolean> {
  const res = await prisma.apiToken.updateMany({
    where: { id: tokenId, repoId, revokedAt: null, repository: { installation: { userId } } },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}
