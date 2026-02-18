// lib/completePendingDojoAction.ts
import { doc, getDoc, setDoc, collection, serverTimestamp, deleteField } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

export type PendingDojoAction =
  | {
      type: "staff_create_dojo";
      dojoName: string;
      country: string;
      city: string;
      website: string | null;
      phone: string | null;
    }
  | {
      type: "staff_join_dojo";
      dojoId: string;
      dojoName: string;
      country: string | null;
      city: string | null;
      website: string | null;
      phone: string | null;
    }
  | {
      type: "student_join_dojo";
      dojoId: string;
      dojoName: string;
    };

function normalizeNameLower(s: string) {
  return s.trim().toLowerCase();
}

function buildKeywords(input: { dojoName: string; city: string; country: string }) {
  const tokens = [input.dojoName, input.city, input.country]
    .map((v) => v.trim())
    .filter(Boolean)
    .flatMap((v) => v.split(/\s+/g))
    .map((v) => v.toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 30);
}

export async function completePendingDojoAction(
  db: Firestore,
  uid: string,
  displayName: string | null
): Promise<string | null> {
  console.log("[pendingAction] Starting for uid:", uid);

  // Step 1: Read user doc
  const userRef = doc(db, "users", uid);
  let snap;
  try {
    snap = await getDoc(userRef);
    console.log("[pendingAction] Step 1 OK - user doc exists:", snap.exists());
  } catch (err) {
    console.error("[pendingAction] Step 1 FAILED - getDoc(users):", err);
    throw err;
  }

  if (!snap.exists()) return null;

  const userData = snap.data();
  const pending = userData?.pendingDojoAction as PendingDojoAction | undefined;
  console.log("[pendingAction] pendingDojoAction:", JSON.stringify(pending));
  console.log("[pendingAction] sessionVerified:", userData?.sessionVerified);
  console.log("[pendingAction] role:", userData?.role);

  if (!pending) return null;

  try {
    if (pending.type === "staff_create_dojo") {
      const dojoName = pending.dojoName.trim();
      const country = (pending.country || "").trim();
      const city = (pending.city || "").trim();
      const website = pending.website?.trim() || null;
      const phone = pending.phone?.trim() || null;

      const dojoRef = doc(collection(db, "dojos"));
      const dojoId = dojoRef.id;
      console.log("[pendingAction] Will create dojo:", dojoId, dojoName);

      const nameLower = normalizeNameLower(dojoName);
      const keywords = buildKeywords({ dojoName, city, country });

      // Step 2: Create dojo
      try {
        await setDoc(dojoRef, {
          name: dojoName,
          nameLower,
          keywords,
          isPublic: true,
          ownerUid: uid,
          ownerIds: [uid],
          createdBy: uid,
          country: country || null,
          city: city || null,
          website,
          phone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log("[pendingAction] Step 2 OK - dojo created:", dojoId);
      } catch (err) {
        console.error("[pendingAction] Step 2 FAILED - setDoc(dojos):", err);
        throw err;
      }

      // Step 3: Create member
      try {
        const memberRef = doc(db, "dojos", dojoId, "members", uid);
        await setDoc(memberRef, {
          uid,
          dojoId,
          status: "approved",
          roleInDojo: "owner",
          role: "owner",
          displayName: displayName || null,
          approvedAt: serverTimestamp(),
          approvedBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log("[pendingAction] Step 3 OK - member created");
      } catch (err) {
        console.error("[pendingAction] Step 3 FAILED - setDoc(members):", err);
        throw err;
      }

      // Step 4: Update user doc
      try {
        await setDoc(
          userRef,
          {
            dojoId,
            staffProfile: {
              dojoId,
              dojoName,
              country,
              city,
              website,
              phone,
              roleInDojo: "owner",
            },
            pendingDojoAction: deleteField(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[pendingAction] Step 4 OK - user updated with dojoId");
      } catch (err) {
        console.error("[pendingAction] Step 4 FAILED - setDoc(users update):", err);
        throw err;
      }

      return "Dojo created successfully!";
    }

    if (pending.type === "staff_join_dojo") {
      const dojoId = pending.dojoId;
      console.log("[pendingAction] Will join dojo:", dojoId);

      // Step 2: Create joinRequest
      try {
        const jrRef = doc(db, "dojos", dojoId, "joinRequests", uid);
        await setDoc(jrRef, {
          uid,
          dojoId,
          status: "pending",
          note: "Staff member join request",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log("[pendingAction] Step 2 OK - joinRequest created");
      } catch (err) {
        console.error("[pendingAction] Step 2 FAILED - setDoc(joinRequests):", err);
        throw err;
      }

      // Step 3: Update user
      try {
        await setDoc(
          userRef,
          {
            dojoId,
            staffProfile: {
              dojoId,
              dojoName: pending.dojoName || "",
              country: pending.country || null,
              city: pending.city || null,
              website: pending.website || null,
              phone: pending.phone || null,
            },
            pendingDojoAction: deleteField(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[pendingAction] Step 3 OK - user updated");
      } catch (err) {
        console.error("[pendingAction] Step 3 FAILED - setDoc(users update):", err);
        throw err;
      }

      return "Join request sent!";
    }

    if (pending.type === "student_join_dojo") {
      const dojoId = pending.dojoId;
      console.log("[pendingAction] Will join as student:", dojoId);

      try {
        await setDoc(
          userRef,
          {
            dojoId,
            dojoName: pending.dojoName || null,
            pendingDojoAction: deleteField(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[pendingAction] Step 2 OK - user updated");
      } catch (err) {
        console.error("[pendingAction] Step 2 FAILED - setDoc(users update):", err);
        throw err;
      }

      return "Joined gym successfully!";
    }

    return null;
  } catch (err) {
    console.error("[pendingAction] Error:", err);
    throw err;
  }
}