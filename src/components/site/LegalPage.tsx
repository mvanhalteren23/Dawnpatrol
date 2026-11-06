import type { ReactNode } from "react";

/** Plain, readable layout for the privacy policy, terms and similar pages. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8 [&_a]:text-[#A87A33] [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-condensed-700 [&_h2]:text-3xl [&_h2]:text-[#1F3B2D] [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#1F3B2D] [&_li]:mb-1.5 [&_p]:mb-4 [&_p]:leading-7 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 text-[#2C3A30]">
      <h1 style={{ lineHeight: 0.98 }} className="font-condensed-800 mb-2 text-4xl text-[#1F3B2D] sm:text-[52px]">{title}</h1>
      <p className="mb-8 text-sm text-[#6B5A43]">Last updated {updated}</p>
      {intro ? <div className="mb-8 text-lg leading-8">{intro}</div> : null}
      {children}
    </article>
  );
}
