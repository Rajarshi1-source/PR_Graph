import { z } from "zod";

/** Max accepted unified diff (bytes) for preflight — bounded so a request cannot exhaust memory. */
export const MAX_PREFLIGHT_PATCH = 1_000_000;

const Range = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([s, e]) => e >= s, "range end < start");

/** Request body shared by `POST /api/v1/preflight` and the public demo endpoint. */
export const PreflightBody = z
  .object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Expected owner/name"),
    patch: z.string().max(MAX_PREFLIGHT_PATCH).optional(),
    files: z
      .array(z.object({ path: z.string().min(1).max(500), ranges: z.array(Range).max(100).optional() }))
      .max(1000)
      .optional(),
    baseSha: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
  })
  .refine((b) => Boolean(b.patch?.trim()) || Boolean(b.files?.length), {
    message: "Provide a unified diff in `patch` or a `files` list",
  });

export type PreflightBodyInput = z.infer<typeof PreflightBody>;
