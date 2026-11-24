"use client";

/** Tick or untick every draft in the review form (the boxes are plain checkboxes named "pick"). */
export function DraftPickAll({ formId }: { formId: string }) {
  const set = (on: boolean) => {
    document.querySelectorAll<HTMLInputElement>(`#${formId} input[name="pick"]`).forEach((b) => (b.checked = on));
  };
  return (
    <span className="flex gap-3 text-xs">
      <button type="button" className="underline" onClick={() => set(true)}>Tick all</button>
      <button type="button" className="underline" onClick={() => set(false)}>Untick all</button>
    </span>
  );
}
