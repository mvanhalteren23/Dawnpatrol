"use client";
import { useEffect, useRef, useState } from "react";

// "Select all" for a list of checkboxes that belong to a form elsewhere on the page (form="…"),
// plus a live count of how many are ticked.
export function SelectAllBox({ form, name }: { form: string; name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="${name}"]`)).filter((b) => !b.disabled);
    const update = () => {
      const all = boxes();
      const on = all.filter((b) => b.checked).length;
      if (ref.current) {
        ref.current.checked = on > 0 && on === all.length;
        ref.current.indeterminate = on > 0 && on < all.length;
      }
      document.dispatchEvent(new CustomEvent(`bulk-count-${form}`, { detail: on }));
    };
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, [form, name]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="${name}"]`).forEach((b) => {
          if (!b.disabled) b.checked = e.target.checked;
        });
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

export function SelectedCount({ form }: { form: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = (e: Event) => setN((e as CustomEvent<number>).detail);
    document.addEventListener(`bulk-count-${form}`, on);
    return () => document.removeEventListener(`bulk-count-${form}`, on);
  }, [form]);
  return <span className="text-sm font-semibold text-dawn-600">{n} selected</span>;
}
