import { describe, expect, it } from "vitest";

import { createProactivePetChatRequest } from "./petProactive";

describe("proactive pet chat request", () => {
  it("uses the same pet_chat task with the selected record and persona", () => {
    expect(createProactivePetChatRequest(["record-1"], "gentle-companion", "简短一点")).toEqual({
      taskType: "pet_chat",
      payload: {
        content: "请根据用户允许的上下文，用一句简短、不施压的方式主动问候或邀请交流。",
        retainedRecordIds: ["record-1"],
        persona: "gentle-companion",
        customPrompt: "简短一点",
      },
    });
  });
});
