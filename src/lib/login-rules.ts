// Where to go after signing in (pure; unit tested). Only paths on this site, never "//evil.com".
export function landingPath(role: string, next: string): string {
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "";
  if (role === "ADMIN" || role === "REP") return safeNext.startsWith("/crm") || safeNext.startsWith("/portal") ? safeNext : "/crm";
  return safeNext.startsWith("/portal") ? safeNext : "/portal";
}
