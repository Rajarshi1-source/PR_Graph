import { NextResponse } from "next/server";

/**
 * RFC 9457 ProblemDetail — the single error shape for every Route Handler.
 * Never leak stack traces or raw error strings to clients (security-and-api.md §B.2).
 */
const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export function titleFor(status: number): string {
  return TITLES[status] ?? "Error";
}

export function problem(
  status: number,
  detail: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { type: "about:blank", title: titleFor(status), status, detail, ...extra },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}
