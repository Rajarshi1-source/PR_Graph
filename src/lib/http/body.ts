import type { NextRequest, NextResponse } from "next/server";
import { problem } from "./problem";

/**
 * Read a JSON body with a hard size cap (checked on the raw text, before parsing), so an oversized
 * or malformed payload becomes a ProblemDetail instead of a 500 or a memory spike.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number,
): Promise<{ data: unknown; error: null } | { data: null; error: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { data: null, error: problem(413, `Body exceeds ${maxBytes} bytes`) };
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { data: null, error: problem(413, `Body exceeds ${maxBytes} bytes`) };
  }
  try {
    return { data: JSON.parse(raw), error: null };
  } catch {
    return { data: null, error: problem(400, "Malformed JSON body") };
  }
}
