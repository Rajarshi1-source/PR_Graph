import { describe, it, expect } from "vitest";
import { generateToken, hashToken, isTokenShaped } from "../apiToken";

describe("API token primitives", () => {
  it("generates prg_ + 32 base62 chars, unique each time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^prg_[0-9A-Za-z]{32}$/);
  });

  it("hashes to a stable sha256 hex digest (the only thing stored)", () => {
    const t = generateToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t.slice(4));
  });

  it("rejects malformed bearer values before any lookup", () => {
    expect(isTokenShaped(generateToken())).toBe(true);
    expect(isTokenShaped("prg_short")).toBe(false);
    expect(isTokenShaped("ghp_" + "a".repeat(32))).toBe(false);
    expect(isTokenShaped("prg_" + "a".repeat(31) + "!")).toBe(false);
  });
});
