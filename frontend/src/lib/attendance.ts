import {
  Firestore,
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";

export type AttendanceStatus = "present" | "late" | "absent";

export type AttendanceDoc = {
  uid: string; // student uid
  status: AttendanceStatus;
  checkedAt?: any;
  updatedAt?: any;
};

export function attendanceCol(db: Firestore, dojoId: string, sessionId: string) {
  return collection(db, "dojos", dojoId, "sessions", sessionId, "attendance");
}

export async function listAttendance(db: Firestore, dojoId: string, sessionId: string) {
  const snap = await getDocs(attendanceCol(db, dojoId, sessionId));
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) })) as AttendanceDoc[];
}

export async function setAttendance(
  db: Firestore,
  dojoId: string,
  sessionId: string,
  studentUid: string,
  status: AttendanceStatus
) {
  const ref = doc(db, "dojos", dojoId, "sessions", sessionId, "attendance", studentUid);
  await setDoc(
    ref,
    {
      uid: studentUid,
      status,
      checkedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function countPresent(db: Firestore, dojoId: string, sessionId: string) {
  // status == present ã®ä»¶æ•°
  const q = query(attendanceCol(db, dojoId, sessionId), where("status", "==", "present"));
  const snap = await getDocs(q);
  return snap.size;
}