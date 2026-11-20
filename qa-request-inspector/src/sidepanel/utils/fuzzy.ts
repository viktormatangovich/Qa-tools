/**
 * Score of `text` for a palette query: 0 means no match. Every word of the query must match —
 * as a substring (best at the start of a word) or, failing that, as a subsequence of letters.
 */
export function fuzzyScore(query: string, text: string): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const haystack = text.toLowerCase();
  let total = 0;
  for (const word of words) {
    const index = haystack.indexOf(word);
    if (index >= 0) {
      const wordStart = index === 0 || /[\s/._:\-([]/.test(haystack[index - 1]);
      total += 100 + (wordStart ? 50 : 0) + (index === 0 ? 25 : 0) - Math.min(index, 40) / 4;
      continue;
    }
    // Subsequence: "hr" finds "HAR"; gaps cost points.
    let position = -1;
    let gaps = 0;
    for (const char of word) {
      const next = haystack.indexOf(char, position + 1);
      if (next < 0) return 0;
      if (position >= 0) gaps += next - position - 1;
      position = next;
    }
    total += Math.max(1, 40 - gaps);
  }
  return total;
}

/** Items that match the query, best first; ties keep the original order. */
export function rankByQuery<T>(query: string, items: T[], textOf: (item: T) => string, limit = 50): T[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, textOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
