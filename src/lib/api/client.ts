import type { z } from "zod";

/** Thrown when an API response is non-2xx; carries the parsed ProblemDetail when available. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** fetch + ProblemDetail unwrap + Zod-parse. The single client entry point for API calls. */
export async function apiFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new ApiError(res.status, detail ?? `Request failed (${res.status})`);
  }
  return schema.parse(await res.json());
}
