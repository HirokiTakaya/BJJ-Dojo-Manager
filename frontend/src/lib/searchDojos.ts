// src/lib/searchDojos.ts
import {
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
  Firestore,
} from "firebase/firestore";

export type DojoLite = {
  id: string;
  name?: string;
  nameLower?: string;
  isPublic?: boolean;
  country?: string | null;
  city?: string | null;
  website?: string | null;
  phone?: string | null;
};

export async function searchPublicDojosByPrefix(
  db: Firestore,
  term: string,
  take = 20
): Promise<DojoLite[]> {
  const s = term.trim().toLowerCase();
  if (!s) return [];

  const q = query(
    collection(db, "dojos"),
    where("isPublic", "==", true),
    orderBy("nameLower"),
    startAt(s),
    endAt(s + "\uf8ff"),
    limit(take)
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DojoLite[];
}