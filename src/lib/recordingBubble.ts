/** Payload emitted by the Rust backend on the "recording:status" event. */
export interface RecordingStatusPayload {
  recording: boolean;
  path: string | null;
  error: string | null;
}

/**
 * Turn a recording status payload into the pet bubble text.
 * Priority: error message > recording in progress > saved file path > null.
 */
export function getRecordingBubbleText(payload: RecordingStatusPayload): string | null {
  if (payload.error) {
    return `🎤 ${payload.error}`;
  }
  if (payload.recording) {
    return "🎤 录音中…（再次按快捷键停止）";
  }
  if (payload.path) {
    const fileName = payload.path.split(/[\\/]/).pop() ?? payload.path;
    return `录音已保存：${fileName}`;
  }
  return null;
}
