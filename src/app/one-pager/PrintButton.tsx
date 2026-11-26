"use client";

/** Opens the print dialog; choose "Save as PDF" to get the one-pager as a PDF. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-[10px] bg-[#1F3B2D] px-4 py-2 text-sm font-semibold text-[#EFE6D4] hover:bg-[#173022]">
      Save as PDF / print
    </button>
  );
}
