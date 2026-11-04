// Knowledge-base history and undo, pure parts (unit tested). Every change keeps the item as it was
// before and after; undoing a change puts the item back to its "before" state.

export type KbSnapshot = { category: string; title: string; content: string; tags: string; isActive: boolean };

export function snapshot(item: KbSnapshot): KbSnapshot {
  return { category: item.category, title: item.title, content: item.content, tags: item.tags, isActive: item.isActive };
}

export function parseSnapshot(json: string | null | undefined): KbSnapshot | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Partial<KbSnapshot>;
    return typeof s.title === "string" && typeof s.content === "string"
      ? { category: s.category ?? "OTHER", title: s.title, content: s.content, tags: s.tags ?? "", isActive: s.isActive !== false }
      : null;
  } catch {
    return null;
  }
}

export type UndoPlan =
  | { op: "delete" } // the change created the item
  | { op: "restore"; data: KbSnapshot } // it changed or deleted the item: put the old version back
  | { op: "none"; reason: string };

/** What undoing one change does, given whether the item still exists. */
export function undoPlan(rev: { action: string; before: string | null; undoneAt?: Date | null }, itemExists: boolean): UndoPlan {
  if (rev.undoneAt) return { op: "none", reason: "That change was already undone." };
  if (rev.action === "create") return itemExists ? { op: "delete" } : { op: "none", reason: "That item has already been deleted." };
  const before = parseSnapshot(rev.before);
  if (!before) return { op: "none", reason: "The earlier version wasn't saved, so this change can't be undone." };
  return { op: "restore", data: before };
}

/** One line for the history list, e.g. "Edited 'Hours'" or "Deleted 'Brake prices'". */
export function describeRevision(rev: { action: string; before: string | null; after: string | null; undoOfId?: string | null }): string {
  const b = parseSnapshot(rev.before);
  const a = parseSnapshot(rev.after);
  const title = a?.title ?? b?.title ?? "an item";
  if (rev.undoOfId) return `Undid a change to "${title}"`;
  if (rev.action === "create") return `Added "${title}"`;
  if (rev.action === "delete") return `Deleted "${title}"`;
  if (b && a && b.isActive !== a.isActive && b.title === a.title && b.content === a.content) return `${a.isActive ? "Turned on" : "Turned off"} "${title}"`;
  if (b && a && b.title !== a.title) return `Renamed "${b.title}" to "${a.title}"`;
  return `Edited "${title}"`;
}
