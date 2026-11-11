// Search in a JSON response: a node matches when its field name or its value (for a leaf)
// contains the query, case-insensitively. Paths are those of JsonTreeNode: "root.items.0.name".

/** Text a leaf value is searched in: the raw value, not the shortened one shown in the tree. */
function leafText(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'object') return null;
  return String(value);
}

/**
 * Whether one node matches. `query` must already be trimmed and lower-cased. Array indices are not
 * field names: searching for "1" should not light up every second array element.
 */
export function nodeMatch(keyName: string | number | null, value: unknown, query: string): { key: boolean; value: boolean } {
  if (!query) return { key: false, value: false };
  const key = typeof keyName === 'string' && keyName.toLowerCase().includes(query);
  const text = leafText(value);
  return { key, value: text !== null && text.toLowerCase().includes(query) };
}

export interface JsonSearchResult {
  /** Matching nodes in the order the tree shows them. */
  paths: string[];
  /** Containers to expand so that every match is visible. */
  ancestors: Set<string>;
}

export function searchJson(data: unknown, rawQuery: string): JsonSearchResult {
  const query = rawQuery.trim().toLowerCase();
  const result: JsonSearchResult = { paths: [], ancestors: new Set() };
  if (!query) return result;

  const visit = (keyName: string | number | null, value: unknown, path: string, parents: string[]) => {
    const match = nodeMatch(keyName, value, query);
    if (match.key || match.value) {
      result.paths.push(path);
      for (const parent of parents) result.ancestors.add(parent);
    }
    if (value && typeof value === 'object') {
      const isArray = Array.isArray(value);
      const inner = [...parents, path];
      Object.entries(value as object).forEach(([childKey, childValue], index) => {
        visit(isArray ? index : childKey, childValue, `${path}.${childKey}`, inner);
      });
    }
  };
  visit(null, data, 'root', []);
  return result;
}
