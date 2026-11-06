"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Stop reloading after this long, so a job stuck on "running" can't reload the page all day. */
export const AUTO_REFRESH_MAX_MS = 10 * 60 * 1000;

/**
 * Re-renders the server page on an interval while background work (e.g. Claude research) runs.
 * Skips reloads while the tab is hidden, and gives up after `maxMs`.
 */
export function AutoRefresh({
  active,
  intervalMs = 4000,
  maxMs = AUTO_REFRESH_MAX_MS,
}: {
  active: boolean;
  intervalMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!active) return;
    setStopped(false);
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started >= maxMs) {
        clearInterval(t);
        setStopped(true);
        return;
      }
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, maxMs, router, run]);

  if (!active || !stopped) return null;
  return (
    <p className="text-sm text-slate-500" role="status">
      Stopped checking automatically after {Math.round(maxMs / 60000)} minutes.{" "}
      <button type="button" className="underline" onClick={() => { router.refresh(); setRun((n) => n + 1); }}>
        Check now and keep checking
      </button>
    </p>
  );
}
