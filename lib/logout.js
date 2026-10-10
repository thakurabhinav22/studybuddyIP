import { signOut } from "firebase/auth";

const KNOWN_DB_NAMES = ["studybuddy_test_cache", "studybuddy_notes_cache"];

async function clearIndexedDb() {
  if (typeof indexedDB === "undefined") return;

  const names = new Set(KNOWN_DB_NAMES);

  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db?.name) names.add(db.name);
      }
    } catch {}
  }

  await Promise.allSettled(
    Array.from(names).map(
      (name) =>
        new Promise((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
            req.onblocked = () => resolve(false);
          } catch {
            resolve(false);
          }
        })
    )
  );
}

async function clearServiceWorkerAndCacheStorage() {
  if (typeof window === "undefined") return;

  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((key) => caches.delete(key)));
    } catch {}
  }

  if ("serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((reg) => reg.unregister()));
    } catch {}
  }
}

export async function clearClientCache() {
  if (typeof window === "undefined") return;

  try {
    localStorage.clear();
  } catch {}

  try {
    sessionStorage.clear();
  } catch {}

  await Promise.allSettled([clearIndexedDb(), clearServiceWorkerAndCacheStorage()]);
}

export async function logoutAndClearCache(auth) {
  try {
    await signOut(auth);
  } catch (e) {
    console.error("Firebase signOut error:", e);
  } finally {
    try {
      await clearClientCache();
    } catch (e) {
      console.error("Cache clear error:", e);
    }
  }
}
