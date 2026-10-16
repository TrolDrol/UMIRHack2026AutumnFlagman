export const demoRegistryKey = "rims.demo.registry.v2";
const journalKey = "rims.demo.journal.v1";
let staged: Map<string, string | null> | null = null;
export const demoStorage = {
  getItem(key: string) {
    if (staged?.has(key)) return staged.get(key) ?? null;
    const shared = localStorage.getItem(key);
    if (shared !== null) return shared;
    const legacy = sessionStorage.getItem(key);
    if (legacy !== null) {
      this.setItem(key, legacy);
      if (!staged) sessionStorage.removeItem(key);
    }
    return legacy;
  },
  setItem(key: string, value: string) {
    if (staged) staged.set(key, value);
    else localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (staged) staged.set(key, null);
    else localStorage.removeItem(key);
  },
};
function apply(entries: [string, string | null][]) {
  for (const [key, value] of entries) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}
export function transaction<T>(run: () => T): T {
  const journal = localStorage.getItem(journalKey);
  if (journal) {
    apply(JSON.parse(journal).after);
    localStorage.removeItem(journalKey);
  }
  staged = new Map();
  try {
    const result = run();
    const after = [...staged].filter(
      ([key, value]) => localStorage.getItem(key) !== value,
    );
    if (after.length) {
      localStorage.setItem(
        journalKey,
        JSON.stringify({
          schemaVersion: 1,
          operationId: crypto.randomUUID(),
          after,
        }),
      );
      apply(after);
      for (const [key] of after) sessionStorage.removeItem(key);
      localStorage.removeItem(journalKey);
      localStorage.setItem("rims.demo.revision.v1", crypto.randomUUID());
    }
    return result;
  } finally {
    staged = null;
  }
}
