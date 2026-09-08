import { describe, expect, it } from "vitest";
import { shouldStartQuickInputDrag } from "./QuickInput";

describe("quick input drag handling", () => {
  it("does not start window dragging when the task label is clicked", () => {
    const labelTarget = {
      closest: (selector: string) => selector.includes("label") ? {} : null,
    };

    expect(shouldStartQuickInputDrag(labelTarget)).toBe(false);
  });
});
