"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";

const AuthContext = createContext({ user: undefined });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    // Safety net: if Firebase doesn't respond in 5 seconds, treat as logged out
    const fallback = setTimeout(() => {
      setUser((prev) => {
        if (prev === undefined) {
          console.warn("Auth timeout — treating as logged out");
          return null;
        }
        return prev;
      });
    }, 5000);

    const unsub = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        clearTimeout(fallback);

        if (firebaseUser) {
          const isTcetEmail = firebaseUser.email && firebaseUser.email.endsWith("@tcetmumbai.in");
          
          if (isTcetEmail) {
            setUser(firebaseUser);
          }

          if (db) {
            try {
              const { ref, get, set } = await import("firebase/database");
              const userRef = ref(db, `users/${firebaseUser.uid}`);
              const snap = await get(userRef);

              const accountExists = snap.exists();
              const isAdmin = accountExists && snap.val().role === "admin";

              if (!isTcetEmail && !accountExists) {
                  console.log("❌ Unauthorized email domain (New Account blocked)");
                  const { getAuth } = await import("firebase/auth");
                  getAuth().signOut();
                  setUser(null);
                  return;
              }
              
              if (!isTcetEmail && accountExists) {
                setUser(firebaseUser);
              }

              const payload = {
                uid: firebaseUser.uid,
                name: firebaseUser.displayName ?? "Student",
                email: firebaseUser.email ?? "",
                photo: firebaseUser.photoURL ?? "",
                branch: "Information Technology",
                college: "Thakur College of Engineering & Technology",
                lastLogin: new Date().toISOString(),
              };

              if (!snap.exists()) {
                await set(userRef, {
                  ...payload,
                  role: "student",
                  joinedAt: new Date().toISOString(),
                  studyHours: 0,
                  aiQuestions: 0,
                  solvedProblems: 0,
                  streak: 0,
                });
                console.log("✅ User created in Realtime DB:", firebaseUser.uid);
              } else {
                const { ref: r2, update } = await import("firebase/database");
                await update(r2(db, `users/${firebaseUser.uid}`), {
                  lastLogin: new Date().toISOString(),
                });
                console.log("✅ User lastLogin updated");
              }
            } catch (err) {
              // DB failed but user is still logged in — dashboard will use Auth data
              console.error("❌ DB write failed:", err.message);
              console.error("Check: Firebase Console → Realtime Database → Rules (set read/write to true for testing)");
            }
          }
        } else {
          setUser(null);
        }
      },
      (error) => {
        clearTimeout(fallback);
        console.error("Auth error:", error);
        setUser(null);
      }
    );

    return () => {
      unsub();
      clearTimeout(fallback);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  return ctx ?? { user: undefined };
}