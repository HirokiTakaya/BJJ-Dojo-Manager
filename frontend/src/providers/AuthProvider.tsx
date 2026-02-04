"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { auth, firebaseEnabled, firebaseDisabledReason } from "@/firebase";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  setAuthLoading?: (v: boolean) => void;      // 互換用（Login側で呼んでた）
  setMfaInProgress?: (v: boolean) => void;    // 互換用
  mfaInProgress?: boolean;
};

const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // ✅ auth が null の可能性があるので安全に
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [loading, setLoading] = useState<boolean>(!!auth); // auth無いなら最初からfalseでOK
  const [mfaInProgress, setMfaInProgress] = useState(false);

  useEffect(() => {
    // ✅ Firebase が無効なら何も購読しない（落ちない）
    if (!firebaseEnabled || !auth) {
      setUser(null);
      setLoading(false);

      // 任意：原因をログで見たいなら
      if (typeof window !== "undefined" && firebaseDisabledReason) {
        console.warn("[AuthProvider] Firebase disabled:", firebaseDisabledReason);
      }
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const value = useMemo<AuthCtx>(() => {
    return {
      user,
      loading,
      mfaInProgress,
      setMfaInProgress,
      setAuthLoading: setLoading,
    };
  }, [user, loading, mfaInProgress]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
