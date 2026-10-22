export function getPetWindowSize({
  bubbleVisible,
  menuOpen,
}: {
  bubbleVisible: boolean;
  menuOpen: boolean;
}): { width: number; height: number } {
  if (menuOpen) return { width: 220, height: 236 };
  if (bubbleVisible) return { width: 240, height: 260 };
  return { width: 128, height: 148 };
}
