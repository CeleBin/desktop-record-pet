function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

/** Return the matching target heading position, clamped to its scroll range. */
export function mapAnchorScrollTop(
  headingIndex: number,
  _sourceAnchors: readonly number[],
  targetAnchors: readonly number[],
  targetMaxScrollTop: number,
): number | null {
  const target = targetAnchors[headingIndex];
  return target == null ? null : clamp(target, targetMaxScrollTop);
}

/**
 * Map a position by its local progress between two matching heading anchors.
 * The final section ends at the corresponding scroll-range maximum.
 */
export function mapSegmentScrollTop(
  sourceScrollTop: number,
  sourceAnchors: readonly number[],
  targetAnchors: readonly number[],
  targetMaxScrollTop: number,
  sourceMaxScrollTop = sourceAnchors[sourceAnchors.length - 1] ?? 0,
): number | null {
  if (sourceAnchors.length !== targetAnchors.length || sourceAnchors.length === 0) {
    return null;
  }

  if (sourceScrollTop < sourceAnchors[0]) {
    const span = sourceAnchors[0];
    if (span <= 0) return 0;
    return clamp((sourceScrollTop / span) * targetAnchors[0], targetMaxScrollTop);
  }

  let index = 0;
  for (let i = 1; i < sourceAnchors.length; i += 1) {
    if (sourceScrollTop < sourceAnchors[i]) break;
    index = i;
  }

  const sourceStart = sourceAnchors[index];
  const targetStart = targetAnchors[index];
  const sourceEnd = sourceAnchors[index + 1] ?? sourceMaxScrollTop;
  const targetEnd = targetAnchors[index + 1] ?? targetMaxScrollTop;
  const span = sourceEnd - sourceStart;
  if (span <= 0) return clamp(targetStart, targetMaxScrollTop);

  const progress = clamp((sourceScrollTop - sourceStart) / span, 1);
  return clamp(targetStart + (targetEnd - targetStart) * progress, targetMaxScrollTop);
}
