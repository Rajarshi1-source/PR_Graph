import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE, type SessionData } from "./session";

/**
 * Read + verify the session inside a Server Component / Server Action. `cookies()` is async
 * in Next.js 16, so this helper must be awaited.
 */
export async function getServerSession(): Promise<SessionData | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
