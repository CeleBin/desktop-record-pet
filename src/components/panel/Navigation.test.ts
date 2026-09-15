import { describe, expect, it } from "vitest";

import {
  TAG_COLORS,
  TAG_COLOR_ROW_CLASS,
  TAG_CREATE_ACTION_SPACING_CLASS,
  TAG_POPOVER_POSITION_CLASS,
  TAG_POPOVER_STYLE,
  hexToHsv,
  hsvToHex,
  isHexColor,
  normalizeCustomTagColors,
  removeCustomTagColor,
  upsertCustomTagColor,
} from "./Navigation";

describe("tag popover sizing", () => {
  it("uses an adaptive width with explicit minimum and maximum bounds", () => {
    expect(TAG_POPOVER_STYLE).toEqual({
      width: "min(320px, calc(100% + 1rem))",
      minWidth: "min(240px, calc(100% + 1rem))",
      maxWidth: "calc(100vw - 2rem)",
    });
  });

  it("left-aligns the color row and keeps space before the primary action", () => {
    expect(TAG_COLOR_ROW_CLASS).toContain("justify-start");
    expect(TAG_CREATE_ACTION_SPACING_CLASS).toBe("mt-2");
  });

  it("centers the tag popover over the navigation content", () => {
    expect(TAG_POPOVER_POSITION_CLASS).toContain("left-1/2");
    expect(TAG_POPOVER_POSITION_CLASS).toContain("-translate-x-1/2");
  });
});

describe("tag color picker values", () => {
  it("keeps the preset palette compact", () => {
    expect(TAG_COLORS).toHaveLength(6);
  });

  it("converts a hex color to HSV", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("converts HSV back to a normalized hex color", () => {
    expect(hsvToHex(120, 1, 1)).toBe("#00ff00");
    expect(hsvToHex(210, 0.5, 0.75)).toBe("#608fbf");
  });

  it("accepts only six-digit hex values", () => {
    expect(isHexColor("#12aBcD")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });

  it("normalizes custom colors and excludes built-in colors", () => {
    expect(normalizeCustomTagColors(["#ABCDEF", "#abcdef", "#a78bfa", "red", 42])).toEqual(["#abcdef"]);
  });

  it("adds or edits a custom color without duplicating it", () => {
    expect(upsertCustomTagColor(["#abcdef"], "#123456")).toEqual(["#abcdef", "#123456"]);
    expect(upsertCustomTagColor(["#abcdef", "#123456"], "#654321", 0)).toEqual(["#654321", "#123456"]);
    expect(upsertCustomTagColor(["#abcdef", "#123456"], "#123456")).toEqual(["#abcdef", "#123456"]);
  });

  it("removes only the selected custom color", () => {
    expect(removeCustomTagColor(["#abcdef", "#123456"], 0)).toEqual(["#123456"]);
  });
});
