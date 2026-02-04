import {
  type Firestore,
  type Timestamp,
  type FieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

type FireTs = Timestamp | FieldValue;

export type MemberRole = "owner" | "staff" | "staff_member" | "coach" | "student";

export type DojoMember = {
  uid: string;
  status: "approved" | "pending";
  roleInDojo: MemberRole;
  dojoId?: string;

  // users doc ã‹ã‚‰ join ã—ã¦å–å¾—ã™ã‚‹æƒ…å ±ï¼ˆã‚ªãƒ—ã‚·ãƒ§ãƒ³ï¼‰
  displayName?: string | null;
  email?: string | null;

  approvedAt?: FireTs;
  approvedBy?: string | null;
  createdAt?: FireTs;
  updatedAt?: FireTs;
};

export type StudentInfo = {
  uid: string;
  displayName: string;
  email: string | null;
  roleInDojo: MemberRole;
};

function membersRef(db: Firestore, dojoId: string) {
  return collection(db, "dojos", dojoId, "members");
}

function memberDocRef(db: Firestore, dojoId: string, memberUid: string) {
  return doc(db, "dojos", dojoId, "members", memberUid);
}

/**
 * ç‰¹å®šã®é“å ´ã®ãƒ¡ãƒ³ãƒãƒ¼ä¸€è¦§ã‚’å–å¾—
 */
export async function listMembers(
  db: Firestore,
  dojoId: string,
  options?: {
    status?: "approved" | "pending";
    roleInDojo?: MemberRole | MemberRole[];
    maxResults?: number;
  }
): Promise<DojoMember[]> {
  const constraints: any[] = [];

  if (options?.status) {
    constraints.push(where("status", "==", options.status));
  }

  if (options?.roleInDojo) {
    if (Array.isArray(options.roleInDojo)) {
      constraints.push(where("roleInDojo", "in", options.roleInDojo));
    } else {
      constraints.push(where("roleInDojo", "==", options.roleInDojo));
    }
  }

  if (options?.maxResults) {
    constraints.push(limit(options.maxResults));
  }

  const q = query(membersRef(db, dojoId), ...constraints);
  const snap = await getDocs(q);

  return snap.docs.map((d) => ({
    uid: d.id,
    ...(d.data() as any),
  })) as DojoMember[];
}

/**
 * æ‰¿èªæ¸ˆã¿ã®ç”Ÿå¾’ä¸€è¦§ã‚’å–å¾—
 * - members ã‹ã‚‰å–å¾—ã—ã€users doc ã¨çµåˆã—ã¦ displayName/email ã‚’å–å¾—
 */
export async function listStudentsWithInfo(
  db: Firestore,
  dojoId: string,
  maxResults: number = 500
): Promise<StudentInfo[]> {
  // 1. members ã‹ã‚‰ student ãƒ­ãƒ¼ãƒ«ã® approved ãƒ¡ãƒ³ãƒãƒ¼ã‚’å–å¾—
  const members = await listMembers(db, dojoId, {
    status: "approved",
    roleInDojo: "student",
    maxResults,
  });

  if (members.length === 0) return [];

  // 2. å„ãƒ¡ãƒ³ãƒãƒ¼ã® users doc ã‚’å–å¾—ã—ã¦ displayName/email ã‚’è£œå®Œ
  const results: StudentInfo[] = [];

  // ãƒãƒƒãƒã§å–å¾—ï¼ˆFirestore ã® in ã‚¯ã‚¨ãƒªã¯æœ€å¤§30ä»¶ãªã®ã§ã€å€‹åˆ¥ã«å–å¾—ï¼‰
  for (const m of members) {
    try {
      const userDoc = await getDoc(doc(db, "users", m.uid));
      const userData = userDoc.exists() ? (userDoc.data() as any) : {};

      results.push({
        uid: m.uid,
        displayName: userData.displayName || m.displayName || "(No Name)",
        email: userData.email || m.email || null,
        roleInDojo: m.roleInDojo,
      });
    } catch {
      // users doc ãŒè¦‹ã¤ã‹ã‚‰ãªãã¦ã‚‚ members ã«ç™»éŒ²ã•ã‚Œã¦ã„ã‚Œã°è¡¨ç¤º
      results.push({
        uid: m.uid,
        displayName: m.displayName || "(No Name)",
        email: m.email || null,
        roleInDojo: m.roleInDojo,
      });
    }
  }

  // displayName ã§ã‚½ãƒ¼ãƒˆ
  results.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return results;
}

/**
 * ç”Ÿå¾’ã‚’ãƒ­ãƒ¼ã‚«ãƒ«ã§ãƒ•ã‚£ãƒ«ã‚¿ãƒ¼ï¼ˆæ¤œç´¢ï¼‰
 */
export function filterStudents(students: StudentInfo[], searchText: string): StudentInfo[] {
  const q = (searchText ?? "").trim().toLowerCase();
  if (!q) return students;

  return students.filter((s) => {
    const name = (s.displayName ?? "").toLowerCase();
    const email = (s.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q) || s.uid.toLowerCase().includes(q);
  });
}

/**
 * ãƒ¡ãƒ³ãƒãƒ¼ã‚’è¿½åŠ ï¼ˆã‚¹ã‚¿ãƒƒãƒ•ãŒç”Ÿå¾’ã‚’ç™»éŒ²ã™ã‚‹å ´åˆãªã©ï¼‰
 */
export async function addMember(
  db: Firestore,
  dojoId: string,
  memberUid: string,
  data: {
    roleInDojo: MemberRole;
    status?: "approved" | "pending";
    approvedBy?: string | null;
  }
) {
  const ref = memberDocRef(db, dojoId, memberUid);

  const payload = {
    uid: memberUid,
    roleInDojo: data.roleInDojo,
    status: data.status ?? "approved",
    dojoId,
    approvedBy: data.approvedBy ?? null,
    approvedAt: data.status === "approved" ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, payload);
}

/**
 * ãƒ¡ãƒ³ãƒãƒ¼ã®ãƒ­ãƒ¼ãƒ«/ã‚¹ãƒ†ãƒ¼ã‚¿ã‚¹ã‚’æ›´æ–°
 */
export async function updateMember(
  db: Firestore,
  dojoId: string,
  memberUid: string,
  patch: Partial<Pick<DojoMember, "roleInDojo" | "status">>
) {
  const ref = memberDocRef(db, dojoId, memberUid);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * ãƒ¡ãƒ³ãƒãƒ¼ã‚’å‰Šé™¤
 */
export async function removeMember(db: Firestore, dojoId: string, memberUid: string) {
  const ref = memberDocRef(db, dojoId, memberUid);
  await deleteDoc(ref);
}