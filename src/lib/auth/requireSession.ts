import type { NextRequest, NextResponse } from "next/server";
import { getSession, type SessionData } from "./session";
import { problem } from "@/lib/http/problem";

/**
 * Route-handler guard: returns the verified session or a ready-to-return 401 ProblemDetail.
 * Keeps the 401 pattern in one place so handlers stay thin (security-and-api.md §B.2).
 *
 *   const { session, error } = requireSession(req);
 *   if (error) return error;
 */
export function requireSession(
  req: NextRequest,
): { session: SessionData; error: null } | { session: null; error: NextResponse } {
  const session = getSession(req);
  if (!session) return { session: null, error: problem(401, "Not authenticated") };
  return { session, error: null };
}
