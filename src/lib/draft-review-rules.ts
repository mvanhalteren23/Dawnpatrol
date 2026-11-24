// Reviewing Claude's knowledge-base drafts on one screen (pure; unit tested). Drafts come from the
// website draft (tag "claude-draft", switched off until approved) and from demo research, where
// facts the research didn't find are guessed (tag "assumed", title ending "(assumed)").

type Tagged = { tags: string; title: string };

const tagList = (tags: string) => tags.split(",").map((t) => t.trim()).filter(Boolean);

/** Waiting for a person to check it: a Claude draft or a guessed fact. */
export function isDraft(i: Tagged): boolean {
  const t = tagList(i.tags);
  return t.includes("claude-draft") || t.includes("assumed");
}

/** A guess (the research didn't find it): left unticked so someone reads it before it goes live. */
export function isGuess(i: Tagged): boolean {
  return tagList(i.tags).includes("assumed") || /\(assumed\)\s*$/i.test(i.title);
}

/** Tags once approved: the draft markers go, anything the team added stays. */
export function approvedTags(tags: string): string {
  return tagList(tags).filter((t) => t !== "claude-draft" && t !== "assumed").join(", ");
}

export function approvedTitle(title: string): string {
  return title.replace(/\s*\(assumed\)\s*$/i, "").trim().slice(0, 200);
}

/** Drafts in review order: guesses last (they need the most reading), then by category and title. */
export function sortDrafts<T extends Tagged & { category: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(isGuess(a)) - Number(isGuess(b)) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}
