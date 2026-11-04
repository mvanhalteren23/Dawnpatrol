import { describe, expect, it } from "vitest";
import { describeRevision, parseSnapshot, snapshot, undoPlan } from "@/lib/kb-history-rules";

const item = { category: "HOURS", title: "Hours", content: "Mon-Fri 8-5", tags: "", isActive: true };
const json = (x: object) => JSON.stringify(x);

describe("knowledge base history", () => {
  it("keeps only the fields that matter", () => {
    expect(snapshot({ ...item, id: "x", updatedBy: "a@b.c" } as typeof item)).toEqual(item);
    expect(parseSnapshot("not json")).toBeNull();
    expect(parseSnapshot(json({ title: "T", content: "C" }))).toEqual({ category: "OTHER", title: "T", content: "C", tags: "", isActive: true });
  });

  it("plans the undo for each kind of change", () => {
    expect(undoPlan({ action: "create", before: null }, true)).toEqual({ op: "delete" });
    expect(undoPlan({ action: "create", before: null }, false).op).toBe("none");
    expect(undoPlan({ action: "update", before: json(item) }, true)).toEqual({ op: "restore", data: item });
    expect(undoPlan({ action: "delete", before: json(item) }, false)).toEqual({ op: "restore", data: item });
    expect(undoPlan({ action: "update", before: json(item), undoneAt: new Date() }, true).op).toBe("none");
    expect(undoPlan({ action: "update", before: null }, true).op).toBe("none");
  });

  it("describes changes in plain words", () => {
    expect(describeRevision({ action: "create", before: null, after: json(item) })).toBe('Added "Hours"');
    expect(describeRevision({ action: "delete", before: json(item), after: null })).toBe('Deleted "Hours"');
    expect(describeRevision({ action: "update", before: json(item), after: json({ ...item, isActive: false }) })).toBe('Turned off "Hours"');
    expect(describeRevision({ action: "update", before: json(item), after: json({ ...item, title: "Opening hours" }) })).toBe('Renamed "Hours" to "Opening hours"');
    expect(describeRevision({ action: "update", before: json(item), after: json({ ...item, content: "Mon-Sat" }) })).toBe('Edited "Hours"');
    expect(describeRevision({ action: "update", before: json(item), after: json(item), undoOfId: "r1" })).toBe('Undid a change to "Hours"');
  });
});
