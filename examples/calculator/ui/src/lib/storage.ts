/**
 * localStorage wrapper for per-browser conveniences (last network, last
 * contract address, proving mode). Storage can be missing or throw (private
 * windows, blocked site data), so every access is guarded and the app still
 * works without it.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
