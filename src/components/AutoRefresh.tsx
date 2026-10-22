"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page on an interval while background work (e.g. Claude research) runs. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
