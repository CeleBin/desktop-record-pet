import { describe, expect, it } from "vitest";

import { getRecordingBubbleText, type RecordingStatusPayload } from "./recordingBubble";

describe("getRecordingBubbleText", () => {
  it("returns the error message prefixed with a mic emoji when payload carries an error", () => {
    expect(
      getRecordingBubbleText({ recording: false, path: null, error: "未找到麦克风" }),
    ).toBe("🎤 未找到麦克风");
  });

  it("returns a recording-in-progress hint when recording is true", () => {
    expect(
      getRecordingBubbleText({ recording: true, path: null, error: null }),
    ).toBe("🎤 录音中…（再次按快捷键停止）");
  });

  it("returns a saved message with the file name when a path is present", () => {
    const payload: RecordingStatusPayload = {
      recording: false,
      path: "C:\\data\\recordings\\recording-20260816-120000.wav",
      error: null,
    };
    expect(getRecordingBubbleText(payload)).toBe("录音已保存：recording-20260816-120000.wav");
  });

  it("returns null for a payload with no error, no recording and no path", () => {
    expect(getRecordingBubbleText({ recording: false, path: null, error: null })).toBeNull();
  });
});
