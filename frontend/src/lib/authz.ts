// MVPでは「Rulesが最終防衛線」。
// UI側で最低限の判定をしたい場合に使うためのスタブ（後で拡張OK）。

export function isStaffLike(userDoc: any) {
  const role = String(userDoc?.role ?? "");
  const roles = userDoc?.roles;

  if (Array.isArray(roles)) return roles.includes("staff_member") || roles.includes("owner");
  if (roles && typeof roles === "object") return !!roles.staff_member || !!roles.owner;

  return role === "staff_member" || role === "owner";
}