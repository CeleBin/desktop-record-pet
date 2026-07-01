import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export interface FileDropPayload {
  paths: string[];
}

export async function listenForFileDrops(
  onDrop: (payload: FileDropPayload) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWebviewWindow().onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") {
      return;
    }

    if (event.payload.paths.length === 0) {
      return;
    }

    await onDrop({ paths: event.payload.paths });
  });
}
