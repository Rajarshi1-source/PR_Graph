"use client";

import { useEffect, useState } from "react";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

function format(iso: string, now: number): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") return rtf.format(Math.round(diff / secs), unit);
  }
  return "";
}

/**
 * "3 minutes ago" that keeps itself current (re-renders every 30 s). Renders the absolute time on
 * the server / first paint so SSR never bakes in a stale relative string.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {now === null ? new Date(iso).toLocaleTimeString() : format(iso, now)}
    </time>
  );
}
