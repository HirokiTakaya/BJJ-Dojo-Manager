package notifications

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"

	stripedom "dojo-manager/backend/internal/domain/stripe"
)

type Service struct {
	client    *firestore.Client
	stripeSvc *stripedom.Service // plan limit checks
}

func NewService(client *firestore.Client) *Service {
	return &Service{client: client}
}

// SetStripeService sets the stripe service for plan limit checks
func (s *Service) SetStripeService(stripeSvc *stripedom.Service) {
	s.stripeSvc = stripeSvc
}

func (s *Service) notificationsCol(uid string) *firestore.CollectionRef {
	return s.client.Collection("users").Doc(uid).Collection("notifications")
}

func (s *Service) noticesCol(dojoID string) *firestore.CollectionRef {
	return s.client.Collection("dojos").Doc(dojoID).Collection("notices")
}

func (s *Service) dojoMembersCol(dojoID string) *firestore.CollectionRef {
	return s.client.Collection("dojos").Doc(dojoID).Collection("members")
}

// GetNotifications gets notifications for a user
func (s *Service) GetNotifications(ctx context.Context, uid string, unreadOnly bool, limit int) (*NotificationsListResult, error) {
	uid = stringsTrim(uid)
	if uid == "" {
		return nil, fmt.Errorf("%w: uid is required", ErrBadRequest)
	}

	query := s.notificationsCol(uid).Query

	if unreadOnly {
		query = query.Where("read", "==", false)
	}

	query = query.OrderBy("createdAt", firestore.Desc)

	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query = query.Limit(limit)

	iter := query.Documents(ctx)
	var notifications []Notification

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get notifications: %w", err)
		}

		var n Notification
		if err := doc.DataTo(&n); err != nil {
			continue
		}
		n.ID = doc.Ref.ID
		notifications = append(notifications, n)
	}

	// unread count (simple scan)
	unreadIter := s.notificationsCol(uid).Query.Where("read", "==", false).Documents(ctx)
	unreadCount := int64(0)
	for {
		_, err := unreadIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		unreadCount++
	}

	return &NotificationsListResult{
		Notifications: notifications,
		UnreadCount:   unreadCount,
	}, nil
}

// MarkRead marks notifications as read
func (s *Service) MarkRead(ctx context.Context, uid string, input MarkReadInput) (int, error) {
	uid = stringsTrim(uid)
	input.Trim()

	if uid == "" {
		return 0, fmt.Errorf("%w: uid is required", ErrBadRequest)
	}

	now := time.Now().UTC()

	if input.MarkAll {
		iter := s.notificationsCol(uid).Query.Where("read", "==", false).Documents(ctx)
		batch := s.client.Batch()
		count := 0

		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				return 0, fmt.Errorf("failed to get notifications: %w", err)
			}

			batch.Set(doc.Ref, map[string]interface{}{
				"read":   true,
				"readAt": now,
			}, firestore.MergeAll)
			count++

			// Firestore batch is limited (500). 安全側で早めにコミット
			if count%450 == 0 {
				if _, err := batch.Commit(ctx); err != nil {
					return 0, fmt.Errorf("failed to mark notifications as read: %w", err)
				}
				batch = s.client.Batch()
			}
		}

		if count > 0 {
			if _, err := batch.Commit(ctx); err != nil {
				return 0, fmt.Errorf("failed to mark notifications as read: %w", err)
			}
		}

		return count, nil
	}

	if input.NotificationID != "" {
		_, err := s.notificationsCol(uid).Doc(input.NotificationID).Set(ctx, map[string]interface{}{
			"read":   true,
			"readAt": now,
		}, firestore.MergeAll)
		if err != nil {
			return 0, fmt.Errorf("failed to mark notification as read: %w", err)
		}
		return 1, nil
	}

	return 0, fmt.Errorf("%w: notificationId or markAll is required", ErrBadRequest)
}

// DeleteNotification deletes a single notification doc for the user
func (s *Service) DeleteNotification(ctx context.Context, uid string, notificationID string) error {
	uid = stringsTrim(uid)
	notificationID = stringsTrim(notificationID)

	if uid == "" || notificationID == "" {
		return fmt.Errorf("%w: uid and notificationId are required", ErrBadRequest)
	}

	_, err := s.notificationsCol(uid).Doc(notificationID).Delete(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete notification: %w", err)
	}
	return nil
}

// CreateNotification creates a notification (optionally with dojoId for plan-limit)
func (s *Service) CreateNotification(ctx context.Context, senderUID string, input CreateNotificationInput) (string, error) {
	input.Trim()
	senderUID = stringsTrim(senderUID)

	if input.TargetUID == "" || input.Title == "" {
		return "", fmt.Errorf("%w: targetUid and title are required", ErrBadRequest)
	}

	// plan limit (if dojoId provided)
	if input.DojoID != "" && s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "announcement"); err != nil {
			return "", err
		}
	}

	notificationType := input.Type
	if notificationType == "" {
		notificationType = "general"
	}

	now := time.Now().UTC()
	ref, _, err := s.notificationsCol(input.TargetUID).Add(ctx, map[string]interface{}{
		"title":     input.Title,
		"body":      input.Body,
		"type":      notificationType,
		"data":      input.Data,
		"read":      false,
		"senderUid": senderUID,
		"dojoId":    input.DojoID,
		"createdAt": now,
	})
	if err != nil {
		return "", fmt.Errorf("failed to create notification: %w", err)
	}

	return ref.ID, nil
}

// SendBulkNotification sends notifications to many dojo members
// returns (sentCount, error)
func (s *Service) SendBulkNotification(ctx context.Context, senderUID string, input SendBulkNotificationInput) (int, error) {
	input.Trim()
	senderUID = stringsTrim(senderUID)

	if input.DojoID == "" || input.Title == "" {
		return 0, fmt.Errorf("%w: dojoId and title are required", ErrBadRequest)
	}

	// Validate audience (helper is in model.go)
	if !IsValidAudience(input.Audience) {
		return 0, fmt.Errorf("%w: audience must be one of: all, students, staff", ErrBadRequest)
	}

	// plan limit: announcement（まとめて1回）
	if s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "announcement"); err != nil {
			return 0, err
		}
	}

	noticeType := input.Type
	if noticeType == "" {
		noticeType = "announcement"
	}

	// build members query by audience
	mq := s.dojoMembersCol(input.DojoID).Query

	switch input.Audience {
	case "", "all":
		// no filter
	case "students":
		mq = mq.Where("roleInDojo", "==", "student")
	case "staff":
		// staff/coach/owner をまとめて対象にする
		mq = mq.Where("roleInDojo", "in", []interface{}{"staff", "coach", "owner"})
	default:
		return 0, fmt.Errorf("%w: invalid audience", ErrBadRequest)
	}

	iter := mq.Documents(ctx)

	now := time.Now().UTC()
	batch := s.client.Batch()
	sent := 0

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("failed to list members for bulk notification: %w", err)
		}

		targetUID := doc.Ref.ID
		if targetUID == "" {
			continue
		}

		ref := s.notificationsCol(targetUID).NewDoc() // auto-id
		batch.Set(ref, map[string]interface{}{
			"title":     input.Title,
			"body":      input.Body,
			"type":      noticeType,
			"read":      false,
			"senderUid": senderUID,
			"dojoId":    input.DojoID,
			"createdAt": now,
		}, firestore.MergeAll)

		sent++

		// Firestore batch limit (500)
		if sent%450 == 0 {
			if _, err := batch.Commit(ctx); err != nil {
				return 0, fmt.Errorf("failed to send bulk notifications: %w", err)
			}
			batch = s.client.Batch()
		}
	}

	if sent > 0 {
		if _, err := batch.Commit(ctx); err != nil {
			return 0, fmt.Errorf("failed to send bulk notifications: %w", err)
		}
	}

	return sent, nil
}

// CreateNotice creates a dojo notice/announcement (with plan limit check)
func (s *Service) CreateNotice(ctx context.Context, senderUID string, input CreateNoticeInput) (string, error) {
	input.Trim()
	senderUID = stringsTrim(senderUID)

	if input.DojoID == "" || input.Title == "" {
		return "", fmt.Errorf("%w: dojoId and title are required", ErrBadRequest)
	}

	// plan limit
	if s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "announcement"); err != nil {
			return "", err
		}
	}

	noticeType := input.Type
	if noticeType == "" {
		noticeType = "notice"
	}

	now := time.Now().UTC()

	publishAt := now
	if input.PublishAt != nil && !input.PublishAt.IsZero() {
		publishAt = input.PublishAt.UTC()
	}

	noticeData := map[string]interface{}{
		"title":     input.Title,
		"body":      input.Body,
		"type":      noticeType,
		"status":    "active",
		"publishAt": publishAt,
		"createdBy": senderUID,
		"createdAt": now,
		"updatedAt": now,
	}

	if input.ExpireAt != nil && !input.ExpireAt.IsZero() {
		noticeData["expireAt"] = input.ExpireAt.UTC()
	}

	ref, _, err := s.noticesCol(input.DojoID).Add(ctx, noticeData)
	if err != nil {
		return "", fmt.Errorf("failed to create notice: %w", err)
	}

	return ref.ID, nil
}

// CountActiveNotices counts active notices in a dojo
func (s *Service) CountActiveNotices(ctx context.Context, dojoID string) (int, error) {
	dojoID = stringsTrim(dojoID)
	if dojoID == "" {
		return 0, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	now := time.Now().UTC()

	// Firestoreでは「expireAtが無い OR expireAt > now」がクエリで書きにくいので、
	// まず publishAt <= now まで絞って、expireAt はコード側で判定する
	iter := s.noticesCol(dojoID).Query.
		Where("status", "==", "active").
		Where("publishAt", "<=", now).
		Documents(ctx)

	count := 0
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("failed to count active notices: %w", err)
		}

		data := doc.Data()

		// expireAt が無ければ有効
		exp, ok := data["expireAt"]
		if !ok || exp == nil {
			count++
			continue
		}

		// expireAt があれば now より未来なら有効
		switch v := exp.(type) {
		case time.Time:
			if v.After(now) {
				count++
			}
		case *time.Time:
			if v != nil && v.After(now) {
				count++
			}
		default:
			// 型が想定外なら「expireAtなし扱い」にしておく（壊れにくさ優先）
			count++
		}
	}

	return count, nil
}

// --- tiny helper (avoid importing strings everywhere) ---
func stringsTrim(s string) string {
	// strings.TrimSpace と同じ。import増やしたくない場合にここで吸収
	i := 0
	j := len(s)

	for i < j {
		c := s[i]
		if c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f' {
			i++
			continue
		}
		break
	}
	for j > i {
		c := s[j-1]
		if c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f' {
			j--
			continue
		}
		break
	}
	return s[i:j]
}
