import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { provisionInstallation } from "@/lib/github/installations";

export const runtime = "nodejs";

/**
 * GitHub App post-install redirect target (the App's "Setup URL"). GitHub sends the user here
 * after they install/configure the app with `?installation_id=...&setup_action=install`. We
 * provision the installation + its repos immediately so the dashboard is populated without
 * waiting for the `installation` webhook (security-and-api.md §A.1).
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    // Not logged in yet — send through OAuth, GitHub will return to the dashboard afterwards.
    return NextResponse.redirect(new URL("/login", env.APP_URL));
  }

  const installationId = Number(req.nextUrl.searchParams.get("installation_id"));
  const setupAction = req.nextUrl.searchParams.get("setup_action");

  if (installationId && setupAction !== "request") {
    try {
      await provisionInstallation({ githubInstallId: installationId, userId: session.userId });
    } catch (err) {
      console.error("[github/setup] provisioning failed:", err);
    }
  }

  return NextResponse.redirect(new URL("/dashboard", env.APP_URL));
}
