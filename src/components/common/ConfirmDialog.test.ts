import { describe, expect, it } from "vitest";

import { shouldRenderCancelButton } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("hides the cancel action for an informational dialog", () => {
    expect(shouldRenderCancelButton(null)).toBe(false);
  });

  it("keeps the cancel action for confirmation dialogs by default", () => {
    expect(shouldRenderCancelButton(undefined)).toBe(true);
    expect(shouldRenderCancelButton("取消")).toBe(true);
  });
});
