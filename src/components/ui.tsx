import Link from "next/link";
import type { ReactNode } from "react";
import { STAGE_LABELS, type Stage } from "@/lib/constants";

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-sky-100 text-sky-800",
  ENGAGED: "bg-indigo-100 text-indigo-800",
  DEMO: "bg-violet-100 text-violet-800",
  PROPOSAL: "bg-amber-100 text-amber-800",
  ONBOARDING: "bg-teal-100 text-teal-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAST_DUE: "bg-red-100 text-red-800",
  CHURNED: "bg-zinc-200 text-zinc-700",
  LOST: "bg-zinc-100 text-zinc-500",
};

export function StageBadge({ stage }: { stage: string }) {
  return <Badge className={STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-700"}>{STAGE_LABELS[stage as Stage] ?? stage}</Badge>;
}

export function Badge({ children, className = "bg-slate-100 text-slate-700" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const color =
    ["ACTIVE", "PAID", "SYNCED", "DONE", "BOOKED"].includes(status) ? "bg-emerald-100 text-emerald-800"
    : ["PAST_DUE", "FAILED", "UNCOLLECTIBLE", "MISSED_OPPORTUNITY"].includes(status) ? "bg-red-100 text-red-800"
    : ["RUNNING", "DIRTY", "OPEN", "TRIALING", "MESSAGE_TAKEN"].includes(status) ? "bg-amber-100 text-amber-800"
    : "bg-slate-100 text-slate-700";
  return <Badge className={color}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  const color = kind === "error" ? "border-red-200 bg-red-50 text-red-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800";
  return <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${color}`}>{children}</div>;
}

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-dawn-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10 hover:text-white hover:no-underline">
      {children}
    </Link>
  );
}
