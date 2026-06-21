import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "PRGraph — See your PR dependencies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Dynamic Open Graph image used for link previews (social/SEO). */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "linear-gradient(135deg, #0b1220 0%, #111827 60%, #052e2b 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, opacity: 0.85 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#22c55e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            PR
          </div>
          PRGraph
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 36, lineHeight: 1.05 }}>
          See your PR dependencies
        </div>
        <div style={{ fontSize: 34, marginTop: 24, maxWidth: 900, opacity: 0.8 }}>
          Live dependency graph of open pull requests — what&apos;s safe to merge, blocked, or
          deadlocked.
        </div>
      </div>
    ),
    size,
  );
}
