import {
  Firestore,
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

export type StudentLite = {
  uid: string;
  displayName: string | null;
  displayNameLower: string | null;
  email: string | null;
  emailLower: string | null;
};

export async function listStudentsForDojo(db: Firestore, dojoId: string, max = 300) {
  // MVP: users コレクションから「dojoId一致」かつ「role=student」
  // ※ Rulesが許可していない場合は permission-denied になるので、その時は members 方式に切り替えが必要
  const usersCol = collection(db, "users");
  const q = query(usersCol, where("dojoId", "==", dojoId), where("role", "==", "student"), limit(max));
  const snap = await getDocs(q);

  const rows: StudentLite[] = snap.docs.map((d) => {
    const data = d.data() as any;
    const displayName = (data.displayName ?? data.studentProfile?.fullName ?? null) as string | null;
    const email = (data.email ?? data.studentProfile?.email ?? null) as string | null;
    return {
      uid: d.id,
      displayName,
      displayNameLower: (data.displayNameLower ?? (displayName ? displayName.toLowerCase() : null)) as string | null,
      email,
      emailLower: (data.emailLower ?? (email ? email.toLowerCase() : null)) as string | null,
    };
  });

  return rows;
}

export function filterStudentsLocal(students: StudentLite[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return students;

  return students.filter((s) => {
    const name = s.displayNameLower ?? "";
    const email = s.emailLower ?? "";
    const uid = s.uid.toLowerCase();
    return name.includes(t) || email.includes(t) || uid.includes(t);
  });
}