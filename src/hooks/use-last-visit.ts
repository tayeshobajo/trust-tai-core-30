import { useEffect, useState } from "react";

const KEY = "tt.last-visit";

/**
 * Remembers when this person last opened Trust Tai OS, so Home can quietly show
 * what changed since then. Read after hydration only.
 */
export function useLastVisit(): { lastVisit: string | null; ready: boolean } {
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      setLastVisit(stored);
      window.localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      setLastVisit(null);
    }
    setReady(true);
  }, []);

  return { lastVisit, ready };
}
