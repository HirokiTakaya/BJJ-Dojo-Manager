/**
 * lib/notifications-api.ts
 * Firebase Functions / Go Cloud Run バックエンド経由で通知を操作
 */

import { apiGet, apiPost, apiDelete, buildUrl, isUsingGoApi } from "./api-client";

// ============================================
// Types
// ============================================

export type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
  dojoId?: string;
  read: boolean;
  readAt?: string;
  senderUid?: string;
  createdAt: string;
};

export type NotificationListResponse = {
  notifications: Notification[];
  unreadCount: number;
};

export type CreateNotificationInput = {
  targetUid: string;
  title: string;
  body?: string;
  type?: string;
  data?: Record<string, any>;
};

export type BulkNotificationInput = {
  dojoId: string;
  title: string;
  body?: string;
  type?: string;
  audience?: "all" | "students" | "staff";
};

// ============================================
// API Functions
// ============================================

export async function getNotifications(
  options?: { limit?: number; unreadOnly?: boolean }
): Promise<NotificationListResponse> {
  if (isUsingGoApi()) {
    // Go: GET /v1/notifications?limit=xxx&unreadOnly=xxx
    const url = buildUrl("/v1/notifications", {
      limit: options?.limit,
      unreadOnly: options?.unreadOnly,
    });
    return apiGet<NotificationListResponse>(url);
  }

  // Functions: GET /getNotifications?limit=xxx&unreadOnly=xxx
  return apiGet<NotificationListResponse>(
    buildUrl("/getNotifications", { limit: options?.limit, unreadOnly: options?.unreadOnly })
  );
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: POST /v1/notifications/markRead
    await apiPost("/v1/notifications/markRead", { notificationId });
  } else {
    // Functions: POST /markNotificationRead
    await apiPost("/markNotificationRead", { notificationId });
  }
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  if (isUsingGoApi()) {
    // Go: POST /v1/notifications/markRead
    return apiPost<{ success: boolean; marked: number }>("/v1/notifications/markRead", {
      markAll: true,
    });
  }

  // Functions: POST /markNotificationRead
  return apiPost<{ success: boolean; marked: number }>("/markNotificationRead", { markAll: true });
}

export async function createNotification(input: CreateNotificationInput): Promise<{ id: string }> {
  if (isUsingGoApi()) {
    // Go: POST /v1/notifications
    return apiPost<{ success: boolean; id: string }>("/v1/notifications", input);
  }

  // Functions: POST /createNotification
  return apiPost<{ success: boolean; id: string }>("/createNotification", input);
}

export async function sendBulkNotification(input: BulkNotificationInput): Promise<{ sent: number }> {
  if (isUsingGoApi()) {
    // Go: POST /v1/notifications/bulk
    return apiPost<{ success: boolean; sent: number }>("/v1/notifications/bulk", input);
  }

  // Functions: POST /sendBulkNotification
  return apiPost<{ success: boolean; sent: number }>("/sendBulkNotification", input);
}

export async function deleteNotification(notificationId: string): Promise<void> {
  if (isUsingGoApi()) {
    // Go: DELETE /v1/notifications/{notificationId}
    await apiDelete(`/v1/notifications/${notificationId}`);
  } else {
    // Functions: DELETE /deleteNotification?id=xxx
    await apiDelete(buildUrl("/deleteNotification", { id: notificationId }));
  }
}

// ============================================
// Utility Functions
// ============================================

export function getNotificationTypeLabel(type: string): string {
  return (
    {
      general: "一般",
      announcement: "お知らせ",
      reminder: "リマインダー",
      payment: "支払い",
      attendance: "出席",
      promotion: "昇級",
    }[type] || type
  );
}

export function getNotificationTypeIcon(type: string): string {
  return (
    {
      general: "📢",
      announcement: "📣",
      reminder: "⏰",
      payment: "💳",
      attendance: "✅",
      promotion: "🥋",
    }[type] || "📌"
  );
}

export function formatNotificationTime(createdAt: string): string {
  const date = new Date(createdAt);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "たった今";
  if (diffMins < 60) return `${diffMins}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays < 7) return `${diffDays}日前`;
  return date.toLocaleDateString("ja-JP");
}
