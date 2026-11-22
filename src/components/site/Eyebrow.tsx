/** The small tracked-out label above a section heading. */
export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div style={{ letterSpacing: "0.2em" }} className={`font-condensed-700 mb-2 text-sm uppercase ${dark ? "text-[#D8B47A]" : "text-[#A87A33]"}`}>{children}</div>;
}
