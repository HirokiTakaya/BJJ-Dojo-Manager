package notifications

import (
	"strings"
	"time"
)

// Notification represents a notification
type Notification struct {
	ID        string                 `firestore:"id" json:"id"`
	Title     string                 `firestore:"title" json:"title"`
	Body      string                 `firestore:"body" json:"body"`
	Type      string                 `firestore:"type" json:"type"`
	Data      map[string]interface{} `firestore:"data,omitempty" json:"data,omitempty"`
	DojoID    string                 `firestore:"dojoId,omitempty" json:"dojoId,omitempty"`
	Read      bool                   `firestore:"read" json:"read"`
	ReadAt    *time.Time             `firestore:"readAt,omitempty" json:"readAt,omitempty"`
	SenderUID string                 `firestore:"senderUid,omitempty" json:"senderUid,omitempty"`
	CreatedAt time.Time              `firestore:"createdAt" json:"createdAt"`
}

// CreateNotificationInput represents input for creating a notification
type CreateNotificationInput struct {
	TargetUID string                 `json:"targetUid"`
	Title     string                 `json:"title"`
	Body      string                 `json:"body,omitempty"`
	Type      string                 `json:"type,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`

	// plan limit / notice連携などで使う場合がある
	DojoID string `json:"dojoId,omitempty"`
}

func (in *CreateNotificationInput) Trim() {
	in.TargetUID = strings.TrimSpace(in.TargetUID)
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	in.Type = strings.TrimSpace(in.Type)
	in.DojoID = strings.TrimSpace(in.DojoID)
}

// CreateNoticeInput represents input for creating a dojo notice/announcement
type CreateNoticeInput struct {
	DojoID string `json:"dojoId"`
	Title  string `json:"title"`
	Body   string `json:"body,omitempty"`
	Type   string `json:"type,omitempty"`

	// Optional: nil のときは保存しない/指定なし
	PublishAt *time.Time `json:"publishAt,omitempty"`
	ExpireAt  *time.Time `json:"expireAt,omitempty"`
}

func (in *CreateNoticeInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	in.Type = strings.TrimSpace(in.Type)
	// PublishAt/ExpireAt は time なので Trim 不要
}

// SendBulkNotificationInput represents input for sending bulk notifications
type SendBulkNotificationInput struct {
	DojoID   string `json:"dojoId"`
	Title    string `json:"title"`
	Body     string `json:"body,omitempty"`
	Type     string `json:"type,omitempty"`
	Audience string `json:"audience,omitempty"` // "all", "students", "staff"
}

func (in *SendBulkNotificationInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	in.Type = strings.TrimSpace(in.Type)
	in.Audience = strings.TrimSpace(in.Audience)
}

// MarkReadInput represents input for marking notifications as read
type MarkReadInput struct {
	NotificationID string `json:"notificationId,omitempty"`
	MarkAll        bool   `json:"markAll,omitempty"`
}

func (in *MarkReadInput) Trim() {
	in.NotificationID = strings.TrimSpace(in.NotificationID)
}

// DeleteNotificationInput represents input for deleting a notification
type DeleteNotificationInput struct {
	NotificationID string `json:"notificationId"`
}

func (in *DeleteNotificationInput) Trim() {
	in.NotificationID = strings.TrimSpace(in.NotificationID)
}

// NotificationsListResult represents the result of listing notifications
type NotificationsListResult struct {
	Notifications []Notification `json:"notifications"`
	UnreadCount   int64          `json:"unreadCount"`
}

// ---- Validation helpers ----

var ValidAudiences = []string{"all", "students", "staff"}

func IsValidAudience(audience string) bool {
	if audience == "" {
		return true // 未指定はOK（service側で default "all" にしてもいい）
	}
	for _, v := range ValidAudiences {
		if v == audience {
			return true
		}
	}
	return false
}
