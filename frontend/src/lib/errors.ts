import { FirebaseError } from "firebase/app";

export function formatFirebaseErr(e: unknown) {
  if (e instanceof FirebaseError) {
    if (e.code === "permission-denied") return "Firestore permission-denied（Rulesを確認してください）";
    if (e.code === "unavailable") return "Firestore unavailable（一時的に利用不可）";
    return `${e.code}: ${e.message}`;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return "Unexpected error.";
}