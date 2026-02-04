/**
 * lib/index.ts
 * 全APIモジュールの再エクスポート
 */

// API Client
export * from "./api-client";

// Dojos
export * from "./dojos-api";

// Timetable / Sessions
export * from "./timetable-api";

// Members
// ✅ 衝突回避：dojos-api と members-api の両方に approveJoinRequest があるため、export * だとビルドで落ちる
// → members-api は一旦 namespace import して、approveJoinRequest 以外だけ再エクスポートする
export type {
  MemberRole,
  MemberStatus,
  DojoMember,
  MemberWithUser,
  CreateMemberInput,
  CreateMemberResponse,
  UpdateMemberInput,
} from "./members-api";

export {
  listMembers,
  getMember,
  createMember,
  updateMember,
  removeMember,
  listStudents,
  listStaff,
  listPendingMembers,

  // ✅ members-api の approveJoinRequest は別名で公開（既存の dojos-api 側の approveJoinRequest はそのまま生かす）
  approveJoinRequest as approveJoinRequestMember,

  filterMembers,
  getRoleLabel,
  getStatusLabel,
  isStaffRole,
} from "./members-api";

// Attendance
export * from "./attendance-api";

// Notifications
export * from "./notifications-api";

// Profile
export * from "./profile-api";

// Ranks / Belts
export * from "./ranks-api";

// Stats
export * from "./stats-api";

// Stripe Payments
export * from "./stripe-api";

// File Uploads
export * from "./uploads-api";
