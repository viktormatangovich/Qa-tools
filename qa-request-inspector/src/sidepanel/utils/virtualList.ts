/** Lists shorter than this are rendered in full: virtualisation only pays off on long lists. */
export const VIRTUALIZE_FROM = 120;

/** Top offset of every item plus the total height as the last element (length = heights.length + 1). */
export function prefixOffsets(heights: number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < heights.length; index += 1) offsets[index + 1] = offsets[index] + heights[index];
  return offsets;
}

/** First item whose bottom edge is below `y` (binary search over the offsets). */
function itemAt(offsets: number[], y: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] <= y) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low);
}

/** Items to render for a viewport: [start, end) with `overscan` pixels above and below. */
export function visibleRange(offsets: number[], scrollTop: number, viewportHeight: number, overscan = 400): [number, number] {
  const count = offsets.length - 1;
  if (count <= 0) return [0, 0];
  const start = itemAt(offsets, Math.max(0, scrollTop - overscan));
  const end = itemAt(offsets, scrollTop + viewportHeight + overscan) + 1;
  return [start, Math.min(count, end)];
}
