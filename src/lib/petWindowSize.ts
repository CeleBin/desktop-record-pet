export function getPetWindowSize({
  bubbleVisible,
  menuOpen,
}: {
  bubbleVisible: boolean;
  menuOpen: boolean;
}): { width: number; height: number } {
  return bubbleVisible || menuOpen
    ? { width: 240, height: 260 }
    : { width: 128, height: 148 };
}
