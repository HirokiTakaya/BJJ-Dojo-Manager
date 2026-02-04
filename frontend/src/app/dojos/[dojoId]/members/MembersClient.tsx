"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { dbNullable, auth } from "@/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

// ============================================
// Types
// ============================================

type Member = {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  roleInDojo: string;
  status: string;
  beltRank?: string;
  stripes?: number;
};

type CreateMemberResponse = {
  success: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
  temporaryPassword?: string;
  error?: string;
};

// ============================================
// Constants
// ============================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const BELT_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  blue: "#0066CC",
  purple: "#6B3FA0",
  brown: "#8B4513",
  black: "#1A1A1A",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "オーナー",
  staff: "スタッフ",
  coach: "コーチ",
  student: "生徒",
};

// ============================================
// Small helpers
// ============================================

function normalizeParam(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function pickFromParams(params: unknown, keys: string[]): string {
  const obj = params as any;
  for (const k of keys) {
    const val = normalizeParam(obj?.[k]);
    if (val) return val;
  }
  return "";
}

function readDojoIdFromPathname(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);

  // 想定: /dojos/<dojoId>/members
  const i = parts.indexOf("dojos");
  if (i >= 0 && parts[i + 1]) {
    return parts[i + 1] || "";
  }
  return "";
}

// ============================================
// API Helper
// ============================================

async function createMemberApi(data: {
  dojoId: string;
  email: string;
  password: string;
  displayName: string;
  roleInDojo: string;
}): Promise<CreateMemberResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken(true);

  const res = await fetch(`${API_BASE}/createMember`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  // JSON が返らないケースも一応ケア
  let json: any = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return json;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 12; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

// ============================================
// Component
// ============================================

export default function MembersClient(props: { dojoId?: string } = {}) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  // ✅ dojoId 解決の優先順位: props → params → query → pathname
  // ✅ params のキーゆらぎにも対応（dojoId / dojold など）
  const dojoId = useMemo(() => {
    const fromProps = (props?.dojoId || "").trim();
    if (fromProps) return fromProps;

    const fromParams = pickFromParams(params, [
      "dojoId",
      "dojold", // もしここが違っていても拾える
      "dojoID",
      "dojoid",
    ]);
    if (fromParams) return fromParams;

    const fromQuery =
      (searchParams.get("dojoId") || "").trim() ||
      (searchParams.get("dojold") || "").trim();
    if (fromQuery) return fromQuery;

    const fromPath = readDojoIdFromPathname();
    return fromPath;
  }, [props?.dojoId, params, searchParams]);

  const [members, setMembers] = useState<Member[]>([]);
  const [pendingMembers, setPendingMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [showTab, setShowTab] = useState<"active" | "pending">("active");

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    displayName: "",
    email: "",
    password: "",
    roleInDojo: "student",
  });
  const [busy, setBusy] = useState(false);
  const [createdMember, setCreatedMember] = useState<CreateMemberResponse | null>(null);

  // 認証チェック
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  // dojoId がない場合のエラー
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    if (!dojoId) {
      setLoading(false);
      setError("dojoId が取得できません。URL / params / query を確認してください。");
    }
  }, [authLoading, user, dojoId]);

  // Load members
  useEffect(() => {
    const load = async () => {
      if (authLoading) return;
      if (!user) return;

      if (!dbNullable) {
        setError("Firebase が初期化されていません");
        setLoading(false);
        return;
      }
      if (!dojoId) return;

      setLoading(true);
      setError("");
      setSuccess("");

      try {
        const snap = await getDocs(collection(dbNullable, "dojos", dojoId, "members"));

        const activeList: Member[] = [];
        const pendingList: Member[] = [];

        for (const d of snap.docs) {
          const data = d.data();
          let userData: any = {};
          try {
            const userSnap = await getDoc(doc(dbNullable, "users", d.id));
            if (userSnap.exists()) userData = userSnap.data();
          } catch {}

          const member: Member = {
            uid: d.id,
            displayName: (data as any).displayName || (userData as any).displayName || "Unknown",
            email: (data as any).email || (userData as any).email,
            photoURL: (data as any).photoURL || (userData as any).photoURL,
            roleInDojo: (data as any).roleInDojo || "student",
            status: (data as any).status || "active",
            beltRank: (data as any).beltRank || "white",
            stripes: (data as any).stripes || 0,
          };

          if (member.status === "pending") pendingList.push(member);
          else activeList.push(member);
        }

        const roleOrder = ["owner", "staff", "coach", "student"];
        activeList.sort(
          (a, b) =>
            roleOrder.indexOf(a.roleInDojo) - roleOrder.indexOf(b.roleInDojo) ||
            a.displayName.localeCompare(b.displayName)
        );
        pendingList.sort((a, b) => a.displayName.localeCompare(b.displayName));

        setMembers(activeList);
        setPendingMembers(pendingList);
      } catch (e: any) {
        setError(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authLoading, user, dojoId]);

  // フィルター
  const filtered = members.filter((m) => {
    if (
      search &&
      !m.displayName?.toLowerCase().includes(search.toLowerCase()) &&
      !m.email?.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterRole !== "all" && m.roleInDojo !== filterRole) return false;
    return true;
  });

  // ✅ メンバー詳細への遷移
  // ✅ あなたの実フォルダ構成: /dojos/[dojoId]/members/[memberId]
  const goMemberDetail = (uid: string) => {
    if (!dojoId) return;
    router.push(`/dojos/${encodeURIComponent(dojoId)}/members/${encodeURIComponent(uid)}`);
  };

  // 参加リクエスト承認
  const approveRequest = async (member: Member) => {
    if (!dbNullable || !dojoId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", member.uid);
      await updateDoc(memberRef, {
        status: "active",
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const userRef = doc(dbNullable, "users", member.uid);
      await updateDoc(userRef, {
        dojoId: dojoId,
        pendingDojoId: null,
        updatedAt: serverTimestamp(),
      });

      setPendingMembers((prev) => prev.filter((m) => m.uid !== member.uid));
      setMembers((prev) => [...prev, { ...member, status: "active" }]);
      setSuccess(`Approved ${member.displayName}!`);
    } catch (e: any) {
      setError(e?.message || "Failed to approve");
    } finally {
      setBusy(false);
    }
  };

  // 参加リクエスト拒否
  const rejectRequest = async (member: Member) => {
    if (!dbNullable || !dojoId) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const memberRef = doc(dbNullable, "dojos", dojoId, "members", member.uid);
      await updateDoc(memberRef, {
        status: "rejected",
        updatedAt: serverTimestamp(),
      });

      setPendingMembers((prev) => prev.filter((m) => m.uid !== member.uid));
      setSuccess(`Rejected ${member.displayName}'s request.`);
    } catch (e: any) {
      setError(e?.message || "Failed to reject");
    } finally {
      setBusy(false);
    }
  };

  // 新規メンバー追加
  const addMember = async () => {
    if (!dojoId || !newMember.displayName.trim() || !newMember.email.trim()) {
      setError("Name and email are required");
      return;
    }
    if (!newMember.email.includes("@")) {
      setError("Invalid email");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    setCreatedMember(null);

    try {
      const password = newMember.password.trim() || generatePassword();
      const result = await createMemberApi({
        dojoId,
        email: newMember.email.trim(),
        password,
        displayName: newMember.displayName.trim(),
        roleInDojo: newMember.roleInDojo,
      });

      if (result.success && result.uid) {
        setMembers((prev) => [
          ...prev,
          {
            uid: result.uid!,
            displayName: newMember.displayName.trim(),
            email: newMember.email.trim(),
            roleInDojo: newMember.roleInDojo,
            status: "active",
            beltRank: "white",
            stripes: 0,
          },
        ]);
        setCreatedMember({ ...result, temporaryPassword: password });
        setSuccess(`Member "${newMember.displayName}" created!`);
      } else {
        throw new Error(result.error || "Failed");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to create member");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setAddModalOpen(false);
    setNewMember({
      displayName: "",
      email: "",
      password: "",
      roleInDojo: "student",
    });
    setCreatedMember(null);
    setError("");
  };

  // 招待リンクをコピー
// 招待リンクをコピー
const copyInviteLink = () => {
  if (!dojoId) {
    setError("dojoId が無いので招待リンクを作れません");
    return;
  }
  if (typeof window === "undefined") return;

  // ✅ 修正: /signup/student → /signup/student-profile
  const link = `${window.location.origin}/signup/student-profile?dojoId=${encodeURIComponent(dojoId)}`;
  navigator.clipboard.writeText(link);
  setSuccess("Invite link copied to clipboard!");
};
  // ✅ Back（あなたの構成が /dojos/[dojoId]/timetable の場合）
  // もし timetable が query 方式ならここだけ元に戻してOK（他はそのまま使える）
  const goBack = () => {
    if (!dojoId) {
      router.push("/dojos/timetable");
      return;
    }
    router.push(`/dojos/${encodeURIComponent(dojoId)}/timetable`);
  };

  if (authLoading || loading) {
    return (
      <main
        style={{
          padding: 24,
          background: "#0b1b22",
          minHeight: "100vh",
          color: "white",
        }}
      >
        Loading...
      </main>
    );
  }

  if (!user) return null;

  // ✅ dojoId が取れない場合は “真っ白” 回避でデバッグ表示
  if (!dojoId) {
    const paramsKeys = (() => {
      try {
        return Object.keys(params as any);
      } catch {
        return [];
      }
    })();

    return (
      <main style={{ padding: 16, background: "#0b1b22", minHeight: "100vh", color: "white" }}>
        <h2 style={{ marginTop: 0 }}>Missing dojoId (MembersClient)</h2>
        <div style={{ opacity: 0.85, marginTop: 8 }}>
          <div>props.dojoId: <b>{String(props?.dojoId || "")}</b></div>
          <div>params keys: <b>{JSON.stringify(paramsKeys)}</b></div>
          <div>query dojoId: <b>{String(searchParams.get("dojoId") || "")}</b></div>
          <div>pathname dojoId: <b>{String(readDojoIdFromPathname() || "")}</b></div>
          <div style={{ marginTop: 12 }}>href:</div>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {typeof window !== "undefined" ? window.location.href : "(server)"}
          </pre>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        padding: 24,
        background: "#0b1b22",
        minHeight: "100vh",
        color: "white",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <button
            onClick={goBack}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              marginBottom: 12,
            }}
          >
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>👥 Members ({members.length})</h1>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={copyInviteLink}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(168, 85, 247, 0.15)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              color: "#a855f7",
              fontWeight: 700,
            }}
          >
            🔗 Copy Invite Link
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              background: "rgba(74, 222, 128, 0.15)",
              border: "1px solid rgba(74, 222, 128, 0.3)",
              color: "#4ade80",
              fontWeight: 700,
            }}
          >
            ➕ Add Member
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#3b1f1f",
            color: "#ffd2d2",
          }}
        >
          ❌ {error}
        </div>
      )}
      {success && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#1f3b2f",
            color: "#d2ffd2",
          }}
        >
          ✅ {success}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setShowTab("active")}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            background: showTab === "active" ? "rgba(17, 168, 255, 0.2)" : "transparent",
            border:
              showTab === "active"
                ? "1px solid rgba(17, 168, 255, 0.4)"
                : "1px solid rgba(255,255,255,0.15)",
            color: "white",
            fontWeight: 700,
          }}
        >
          Active ({members.length})
        </button>
        <button
          onClick={() => setShowTab("pending")}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            background: showTab === "pending" ? "rgba(250, 204, 21, 0.2)" : "transparent",
            border:
              showTab === "pending"
                ? "1px solid rgba(250, 204, 21, 0.4)"
                : "1px solid rgba(255,255,255,0.15)",
            color: "white",
            fontWeight: 700,
            position: "relative",
          }}
        >
          Pending ({pendingMembers.length})
          {pendingMembers.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#facc15",
              }}
            />
          )}
        </button>
      </div>

      {/* Active Members */}
      {showTab === "active" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <input
              placeholder="🔍 Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                padding: 12,
                borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "white",
              }}
            />
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              style={{
                padding: 12,
                borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "white",
              }}
            >
              <option value="all">All Roles</option>
              <option value="student">Students</option>
              <option value="coach">Coaches</option>
              <option value="staff">Staff</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", opacity: 0.7 }}>
              {members.length === 0 ? "No members yet." : "No results."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filtered.map((m) => (
                <div
                  key={m.uid}
                  onClick={() => goMemberDetail(m.uid)}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                >
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: "50%",
                      background: "rgba(17, 168, 255, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      fontWeight: 700,
                    }}
                  >
                    {m.displayName?.charAt(0).toUpperCase() || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{m.displayName}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>{m.email}</div>
                  </div>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 20,
                      background: "rgba(255,255,255,0.1)",
                      fontSize: 12,
                    }}
                  >
                    {ROLE_LABELS[m.roleInDojo] || m.roleInDojo}
                  </span>
                  <div
                    style={{
                      width: 30,
                      height: 10,
                      borderRadius: 2,
                      background: BELT_COLORS[m.beltRank || "white"],
                      border: "1px solid rgba(255,255,255,0.3)",
                    }}
                  />
                  <span style={{ opacity: 0.5 }}>→</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pending Requests */}
      {showTab === "pending" && (
        <div>
          {pendingMembers.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", opacity: 0.7 }}>No pending requests.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {pendingMembers.map((m) => (
                <div
                  key={m.uid}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(250, 204, 21, 0.05)",
                    border: "1px solid rgba(250, 204, 21, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: "50%",
                      background: "rgba(250, 204, 21, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      fontWeight: 700,
                    }}
                  >
                    {m.displayName?.charAt(0).toUpperCase() || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{m.displayName}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>{m.email}</div>
                  </div>
                  <button
                    onClick={() => approveRequest(m)}
                    disabled={busy}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 10,
                      background: "rgba(74, 222, 128, 0.2)",
                      border: "1px solid rgba(74, 222, 128, 0.4)",
                      color: "#4ade80",
                      fontWeight: 700,
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => rejectRequest(m)}
                    disabled={busy}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 10,
                      background: "rgba(239, 68, 68, 0.2)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#f87171",
                      fontWeight: 700,
                    }}
                  >
                    ✗ Reject
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Member Modal */}
      {addModalOpen && (
        <div
          onClick={closeModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(500px, 100%)",
              borderRadius: 16,
              background: "#0b1b22",
              border: "1px solid rgba(255,255,255,0.14)",
              padding: 24,
            }}
          >
            {createdMember?.success ? (
              <>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 48 }}>✅</div>
                  <h3 style={{ margin: "12px 0 0" }}>Member Created!</h3>
                </div>

                <div
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    background: "rgba(74, 222, 128, 0.1)",
                    border: "1px solid rgba(74, 222, 128, 0.3)",
                    marginBottom: 20,
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Name</div>
                    <div style={{ fontWeight: 700 }}>{createdMember.displayName}</div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Email</div>
                    <div style={{ fontWeight: 700 }}>{createdMember.email}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Temporary Password</div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontFamily: "monospace",
                        fontSize: 18,
                        color: "#4ade80",
                      }}
                    >
                      {createdMember.temporaryPassword}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: "rgba(250, 204, 21, 0.1)",
                    border: "1px solid rgba(250, 204, 21, 0.3)",
                    marginBottom: 20,
                    fontSize: 13,
                  }}
                >
                  ⚠️ Save this password! Share it securely with the member.
                </div>

                <button
                  onClick={closeModal}
                  style={{
                    width: "100%",
                    padding: "14px 20px",
                    borderRadius: 10,
                    background: "rgba(17, 168, 255, 0.2)",
                    border: "1px solid rgba(17, 168, 255, 0.4)",
                    color: "white",
                    fontWeight: 700,
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 20px" }}>➕ Add New Member</h3>

                <div style={{ display: "grid", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 13, opacity: 0.8 }}>Name *</label>
                    <input
                      value={newMember.displayName}
                      onChange={(e) => setNewMember((p) => ({ ...p, displayName: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        marginTop: 6,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "white",
                      }}
                      placeholder="John Doe"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 13, opacity: 0.8 }}>Email *</label>
                    <input
                      type="email"
                      value={newMember.email}
                      onChange={(e) => setNewMember((p) => ({ ...p, email: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        marginTop: 6,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "white",
                      }}
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 13, opacity: 0.8 }}>Password (auto-generated if empty)</label>
                    <input
                      value={newMember.password}
                      onChange={(e) => setNewMember((p) => ({ ...p, password: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        marginTop: 6,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "white",
                      }}
                      placeholder="Leave empty to auto-generate"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 13, opacity: 0.8 }}>Role</label>
                    <select
                      value={newMember.roleInDojo}
                      onChange={(e) => setNewMember((p) => ({ ...p, roleInDojo: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        marginTop: 6,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "white",
                      }}
                    >
                      <option value="student">Student</option>
                      <option value="coach">Coach</option>
                      <option value="staff">Staff</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      onClick={closeModal}
                      style={{
                        padding: "12px 18px",
                        borderRadius: 10,
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "white",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addMember}
                      disabled={busy || !newMember.displayName.trim() || !newMember.email.trim()}
                      style={{
                        padding: "12px 20px",
                        borderRadius: 10,
                        background: "rgba(74, 222, 128, 0.2)",
                        border: "1px solid rgba(74, 222, 128, 0.4)",
                        color: "#4ade80",
                        fontWeight: 700,
                        opacity: !newMember.displayName.trim() || !newMember.email.trim() ? 0.5 : 1,
                      }}
                    >
                      {busy ? "Creating..." : "Create Member"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
