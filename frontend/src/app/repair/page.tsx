"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, dbNullable } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function RepairPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Loading...");
  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus("Not signed in. Please login first.");
        return;
      }

      setStatus(`Signed in as: ${user.email}`);
      setUserId(user.uid);
      setUserEmail(user.email);

      if (!dbNullable) {
        setStatus("Firestore not available");
        return;
      }

      // Get current user doc
      const userRef = doc(dbNullable, "users", user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        setUserData(snap.data());
      } else {
        setUserData({ _documentMissing: true });
      }
    });

    return () => unsub();
  }, []);

  const repairAsStaff = async () => {
    const user = auth.currentUser;
    if (!user || !dbNullable) return;

    setBusy(true);
    setStatus("Repairing as STAFF...");

    try {
      const userRef = doc(dbNullable, "users", user.uid);
      
      // 既存データを取得
      const snap = await getDoc(userRef);
      const existingData = snap.exists() ? snap.data() : {};
      
      // dojoId を既存データから取得
      const dojoId = existingData?.dojoId || existingData?.staffProfile?.dojoId || null;

      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: user.email,
          emailLower: user.email?.toLowerCase() ?? "",
          displayName: existingData?.displayName || user.displayName || null,

          // ★ 必須フィールド
          role: "staff_member",
          roles: ["staff_member"],
          accountType: "staff_member",
          roleUi: "staff",

          // dojoId を保持
          ...(dojoId ? { dojoId } : {}),

          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      // members ドキュメントも修復（dojoId がある場合）
      if (dojoId) {
        const memberRef = doc(dbNullable, "dojos", dojoId, "members", user.uid);
        const memberSnap = await getDoc(memberRef);
        
        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          // roleInDojo が owner/staff でなければ修復
          if (!["owner", "staff", "staff_member", "coach"].includes(memberData?.roleInDojo)) {
            await setDoc(
              memberRef,
              {
                roleInDojo: "owner",
                role: "owner",
                status: "approved",
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            console.log("[Repair] Fixed member doc roleInDojo");
          }
        } else {
          // members ドキュメントがない場合は作成
          await setDoc(memberRef, {
            uid: user.uid,
            dojoId,
            status: "approved",
            roleInDojo: "owner",
            role: "owner",
            approvedAt: serverTimestamp(),
            approvedBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          console.log("[Repair] Created member doc");
        }
      }

      setStatus("✅ Repaired as STAFF! Please refresh or sign out and sign in again.");

      // Reload user data
      const newSnap = await getDoc(userRef);
      setUserData(newSnap.data() ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`❌ Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const repairAsStudent = async () => {
    const user = auth.currentUser;
    if (!user || !dbNullable) return;

    setBusy(true);
    setStatus("Repairing as STUDENT...");

    try {
      const userRef = doc(dbNullable, "users", user.uid);
      
      const snap = await getDoc(userRef);
      const existingData = snap.exists() ? snap.data() : {};

      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: user.email,
          emailLower: user.email?.toLowerCase() ?? "",
          displayName: existingData?.displayName || user.displayName || null,

          role: "student",
          roles: ["student"],
          accountType: "student",
          roleUi: "student",

          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStatus("✅ Repaired as STUDENT! Please refresh or sign out and sign in again.");

      const newSnap = await getDoc(userRef);
      setUserData(newSnap.data() ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`❌ Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const roleStatus = userData ? {
    role: userData.role ?? "(missing)",
    roleUi: userData.roleUi ?? "(missing)",
    roles: userData.roles ?? "(missing)",
    accountType: userData.accountType ?? "(missing)",
    dojoId: userData.dojoId ?? "(none)",
  } : null;

  const needsRepair = userData && (
    !userData.role || 
    !userData.roles || 
    !userData.accountType || 
    !userData.roleUi
  );

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "#0b1b22", 
      color: "white", 
      padding: 24 
    }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, marginBottom: 20 }}>🔧 User Document Repair</h1>

        {/* Status */}
        <div style={{ 
          padding: 16, 
          background: "rgba(255,255,255,0.1)", 
          borderRadius: 12,
          marginBottom: 16
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Status</div>
          <div>{status}</div>
          {userId && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
              UID: {userId}
            </div>
          )}
        </div>

        {/* Role Status */}
        {roleStatus && (
          <div style={{ 
            padding: 16, 
            background: needsRepair ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)", 
            border: `1px solid ${needsRepair ? "#ef4444" : "#22c55e"}`,
            borderRadius: 12,
            marginBottom: 16
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {needsRepair ? "⚠️ Role Fields Need Repair" : "✅ Role Fields OK"}
            </div>
            <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
              <div>role: <code>{String(roleStatus.role)}</code></div>
              <div>roleUi: <code>{String(roleStatus.roleUi)}</code></div>
              <div>roles: <code>{JSON.stringify(roleStatus.roles)}</code></div>
              <div>accountType: <code>{String(roleStatus.accountType)}</code></div>
              <div>dojoId: <code>{String(roleStatus.dojoId)}</code></div>
            </div>
          </div>
        )}

        {/* Repair Buttons */}
        <div style={{ 
          display: "flex", 
          gap: 12, 
          marginBottom: 24 
        }}>
          <button
            onClick={repairAsStaff}
            disabled={busy}
            style={{
              flex: 1,
              padding: 16,
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 12,
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 16,
              opacity: busy ? 0.6 : 1,
            }}
          >
            🏢 Repair as STAFF
          </button>

          <button
            onClick={repairAsStudent}
            disabled={busy}
            style={{
              flex: 1,
              padding: 16,
              background: "#22c55e",
              color: "white",
              border: "none",
              borderRadius: 12,
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 16,
              opacity: busy ? 0.6 : 1,
            }}
          >
            🎓 Repair as STUDENT
          </button>
        </div>

        {/* Full User Data */}
        {userData && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Full User Document</div>
            <pre style={{ 
              background: "#1a1a2e", 
              color: "#22c55e", 
              padding: 16, 
              borderRadius: 12, 
              overflow: "auto",
              fontSize: 12,
              maxHeight: 400,
            }}>
              {JSON.stringify(userData, null, 2)}
            </pre>
          </div>
        )}

        {/* Navigation */}
        <div style={{ 
          marginTop: 24, 
          display: "flex", 
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
        }}>
          <button
            onClick={() => router.push("/home")}
            style={{ 
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              color: "white",
              cursor: "pointer",
            }}
          >
            Go to /home
          </button>
          <button
            onClick={() => router.push("/dojos/timetable")}
            style={{ 
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              color: "white",
              cursor: "pointer",
            }}
          >
            Go to /dojos/timetable
          </button>
          <button
            onClick={async () => {
              await auth.signOut();
              router.push("/login");
            }}
            style={{ 
              padding: "10px 20px",
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 8,
              color: "#fca5a5",
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: "rgba(255,255,255,0.05)", borderRadius: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 Troubleshooting Tips</div>
          <ul style={{ margin: 0, paddingLeft: 20, opacity: 0.8 }}>
            <li>修復後は <b>サインアウト → サインイン</b> してトークンを更新してください</li>
            <li>Cloud Functions は Firebase Auth のトークンを使うため、サインインし直すことで新しい情報が反映されます</li>
            <li>それでも問題がある場合は、members ドキュメントの roleInDojo が "owner" または "staff" になっているか確認してください</li>
          </ul>
        </div>
      </div>
    </div>
  );
}