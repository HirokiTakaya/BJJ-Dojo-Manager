"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth, dbNullable } from "@/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function RepairPage() {
  const router = useRouter();
  const t = useTranslations("repair");
  const [status, setStatus] = useState(t("loading"));
  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [_userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus(t("notSignedIn"));
        return;
      }

      setStatus(t("signedInAs", { email: user.email ?? "" }));
      setUserId(user.uid);
      setUserEmail(user.email);

      if (!dbNullable) {
        setStatus(t("firestoreUnavailable"));
        return;
      }

      const userRef = doc(dbNullable, "users", user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        setUserData(snap.data());
      } else {
        setUserData({ _documentMissing: true });
      }
    });

    return () => unsub();
  }, [t]);

  const repairAsStaff = async () => {
    const user = auth.currentUser;
    if (!user || !dbNullable) return;

    setBusy(true);
    setStatus(t("repairingStaff"));

    try {
      const userRef = doc(dbNullable, "users", user.uid);
      const snap = await getDoc(userRef);
      const existingData = snap.exists() ? snap.data() : {};
      const dojoId = existingData?.dojoId || existingData?.staffProfile?.dojoId || null;

      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: user.email,
          emailLower: user.email?.toLowerCase() ?? "",
          displayName: existingData?.displayName || user.displayName || null,
          role: "staff_member",
          roles: ["staff_member"],
          accountType: "staff_member",
          roleUi: "staff",
          ...(dojoId ? { dojoId } : {}),
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (dojoId) {
        const memberRef = doc(dbNullable, "dojos", dojoId, "members", user.uid);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
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
          }
        } else {
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
        }
      }

      setStatus(t("repairedStaff"));

      const newSnap = await getDoc(userRef);
      setUserData(newSnap.data() ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(t("errorPrefix", { message: msg }));
    } finally {
      setBusy(false);
    }
  };

  const repairAsStudent = async () => {
    const user = auth.currentUser;
    if (!user || !dbNullable) return;

    setBusy(true);
    setStatus(t("repairingStudent"));

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

      setStatus(t("repairedStudent"));

      const newSnap = await getDoc(userRef);
      setUserData(newSnap.data() ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(t("errorPrefix", { message: msg }));
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
    <div style={{ minHeight: "100vh", background: "#0b1b22", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, marginBottom: 20 }}>🔧 {t("title")}</h1>

        <div style={{ padding: 16, background: "rgba(255,255,255,0.1)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("statusLabel")}</div>
          <div>{status}</div>
          {userId && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
              UID: {userId}
            </div>
          )}
        </div>

        {roleStatus && (
          <div style={{
            padding: 16,
            background: needsRepair ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)",
            border: `1px solid ${needsRepair ? "#ef4444" : "#22c55e"}`,
            borderRadius: 12,
            marginBottom: 16,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {needsRepair ? t("needsRepair") : t("fieldsOk")}
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

        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
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
            {t("repairAsStaff")}
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
            {t("repairAsStudent")}
          </button>
        </div>

        {userData && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("fullUserDoc")}</div>
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

        <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => router.push("/home")}
            style={{ padding: "10px 20px", background: "transparent", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, color: "white", cursor: "pointer" }}
          >
            {t("goToHome")}
          </button>
          <button
            onClick={() => router.push("/dojos/timetable")}
            style={{ padding: "10px 20px", background: "transparent", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, color: "white", cursor: "pointer" }}
          >
            {t("goToTimetable")}
          </button>
          <button
            onClick={async () => {
              await auth.signOut();
              router.push("/login");
            }}
            style={{ padding: "10px 20px", background: "rgba(239, 68, 68, 0.2)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, color: "#fca5a5", cursor: "pointer" }}
          >
            {t("signOut")}
          </button>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: "rgba(255,255,255,0.05)", borderRadius: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("tipsTitle")}</div>
          <ul style={{ margin: 0, paddingLeft: 20, opacity: 0.8 }}>
            <li>{t("tip1")}</li>
            <li>{t("tip2")}</li>
            <li>{t("tip3")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
