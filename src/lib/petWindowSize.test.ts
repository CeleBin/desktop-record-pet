import { describe, expect, it } from "vitest";

import { getPetWindowSize } from "./petWindowSize";

describe("pet window size", () => {
  it("expands while a menu is open so every action remains reachable", () => {
    expect(getPetWindowSize({ bubbleVisible: false, menuOpen: true })).toEqual({ width: 240, height: 260 });
  });

  it("stays compact while the pet is idle", () => {
    expect(getPetWindowSize({ bubbleVisible: false, menuOpen: false })).toEqual({ width: 128, height: 148 });
  });
});
