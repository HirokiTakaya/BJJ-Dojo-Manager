package handlers

import (
	"context"
	"net/http"
	"time"

	"dojo-manager/backend/internal/authctx"
	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/firebase"
	"dojo-manager/backend/internal/httpjson"
	"dojo-manager/backend/internal/middleware"
	"dojo-manager/backend/internal/models"
	"dojo-manager/backend/internal/utils"

	"cloud.google.com/go/firestore"
	firebaseauth "firebase.google.com/go/v4/auth"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/iterator"
)

type Legacy struct {
	cfg     config.Config
	clients *firebase.Clients
}

func NewLegacy(cfg config.Config, clients *firebase.Clients) *Legacy {
	return &Legacy{cfg: cfg, clients: clients}
}

func (h *Legacy) Ping(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"ts": time.Now().Unix(),
	})
}

// --- Bookings (dojo class reservations) ---

type createBookingReq struct {
	DojoID  string `json:"dojoId"`
	ClassID string `json:"classId,omitempty"`
	StartAt string `json:"startAt"`
	EndAt   string `json:"endAt"`
}

func (h *Legacy) CreateBookingRequest(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())

	var req createBookingReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.StartAt == "" || req.EndAt == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId, startAt, endAt required")
		return
	}
	start, err := utils.ParseTime(req.StartAt)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid startAt")
		return
	}
	end, err := utils.ParseTime(req.EndAt)
	if err != nil || !end.After(start) {
		httpjson.Error(w, http.StatusBadRequest, "invalid endAt")
		return
	}

	// Optional conflict check (simple)
	conflict, _ := h.hasBookingConflict(r.Context(), req.DojoID, req.ClassID, start, end)
	if conflict {
		httpjson.Error(w, http.StatusConflict, "booking conflict")
		return
	}

	now := time.Now()
	booking := models.Booking{
		DojoID:    req.DojoID,
		UserID:    uid,
		ClassID:   req.ClassID,
		StartAt:   start,
		EndAt:     end,
		Status:    "pending",
		CreatedAt: now,
		UpdatedAt: now,
	}

	ref, _, err := h.clients.Firestore.Collection("bookings").Add(r.Context(), booking)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create booking")
		return
	}
	httpjson.Write(w, http.StatusCreated, map[string]interface{}{"bookingId": ref.ID, "booking": booking})
}

type updateBookingStatusReq struct {
	BookingID string `json:"bookingId"`
	Status    string `json:"status"`
}

func (h *Legacy) UpdateBookingStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req updateBookingStatusReq
	if err := httpjson.Read(r, &req); err != nil || req.BookingID == "" || req.Status == "" {
		httpjson.Error(w, http.StatusBadRequest, "bookingId and status required")
		return
	}
	_, err := h.clients.Firestore.Collection("bookings").Doc(req.BookingID).Set(r.Context(), map[string]interface{}{
		"status":    req.Status,
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

type cancelByUserReq struct {
	UserID string `json:"userId,omitempty"`
}

func (h *Legacy) CancelBookingByUserID(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	claims, _ := authctx.Claims(r.Context())

	var req cancelByUserReq
	_ = httpjson.Read(r, &req)
	target := uid
	if req.UserID != "" {
		// allow staff to cancel others
		if !middleware.IsStaff(claims) {
			httpjson.Error(w, http.StatusForbidden, "staff role required to cancel other users")
			return
		}
		target = req.UserID
	}

	ctx := r.Context()
	it := h.clients.Firestore.Collection("bookings").Where("userId", "==", target).Where("status", "in", []interface{}{"pending", "accepted"}).Limit(200).Documents(ctx)
	batch := h.clients.Firestore.Batch()
	count := 0
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		batch.Set(snap.Ref, map[string]interface{}{"status": "cancelled", "updatedAt": time.Now()}, firestore.MergeAll)
		count++
	}
	if count == 0 {
		httpjson.Write(w, http.StatusOK, map[string]interface{}{"updated": 0})
		return
	}
	_, err := batch.Commit(ctx)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "batch update failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"updated": count})
}

type cancelByUnitReq struct {
	DojoID  string `json:"dojoId"`
	ClassID string `json:"classId"`
}

func (h *Legacy) CancelBookingByUnitID(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req cancelByUnitReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.ClassID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId and classId required")
		return
	}

	ctx := r.Context()
	it := h.clients.Firestore.Collection("bookings").
		Where("dojoId", "==", req.DojoID).
		Where("classId", "==", req.ClassID).
		Where("status", "in", []interface{}{"pending", "accepted"}).
		Limit(500).Documents(ctx)

	batch := h.clients.Firestore.Batch()
	count := 0
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		batch.Set(snap.Ref, map[string]interface{}{"status": "cancelled", "updatedAt": time.Now()}, firestore.MergeAll)
		count++
	}
	if count > 0 {
		if _, err := batch.Commit(ctx); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "batch update failed")
			return
		}
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"updated": count})
}

type bulkFetchReq struct {
	DojoID  string `json:"dojoId"`
	StartAt string `json:"startAt,omitempty"`
	EndAt   string `json:"endAt,omitempty"`
	Limit   int    `json:"limit,omitempty"`
}

func (h *Legacy) BulkFetchBookings(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}

	var req bulkFetchReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId required")
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	q := h.clients.Firestore.Collection("bookings").Where("dojoId", "==", req.DojoID)
	if req.StartAt != "" {
		if t, err := utils.ParseTime(req.StartAt); err == nil {
			q = q.Where("startAt", ">=", t)
		}
	}
	if req.EndAt != "" {
		if t, err := utils.ParseTime(req.EndAt); err == nil {
			q = q.Where("startAt", "<", t)
		}
	}

	it := q.OrderBy("startAt", firestore.Asc).Limit(limit).Documents(r.Context())
	items := make([]map[string]interface{}, 0, limit)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		items = append(items, map[string]interface{}{"bookingId": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

type findBookingsReq struct {
	UserID string `json:"userId,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

func (h *Legacy) FindBookingsByUserID(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	claims, _ := authctx.Claims(r.Context())

	var req findBookingsReq
	_ = httpjson.Read(r, &req)

	target := uid
	if req.UserID != "" {
		if !middleware.IsStaff(claims) {
			httpjson.Error(w, http.StatusForbidden, "staff role required to query other users")
			return
		}
		target = req.UserID
	}
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	it := h.clients.Firestore.Collection("bookings").
		Where("userId", "==", target).
		OrderBy("startAt", firestore.Desc).
		Limit(limit).
		Documents(r.Context())

	items := make([]map[string]interface{}, 0, limit)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		items = append(items, map[string]interface{}{"bookingId": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

type amenityReq struct {
	DojoID      string `json:"dojoId"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

func (h *Legacy) CreateAmenity(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req amenityReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.Name == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId and name required")
		return
	}
	now := time.Now()
	ref, _, err := h.clients.Firestore.Collection("dojos").Doc(req.DojoID).Collection("amenities").Add(r.Context(), map[string]interface{}{
		"name":        req.Name,
		"description": req.Description,
		"createdAt":   now,
		"updatedAt":   now,
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create amenity")
		return
	}
	httpjson.Write(w, http.StatusCreated, map[string]interface{}{"amenityId": ref.ID})
}

type conflictReq struct {
	DojoID  string `json:"dojoId"`
	ClassID string `json:"classId,omitempty"`
	StartAt string `json:"startAt"`
	EndAt   string `json:"endAt"`
}

func (h *Legacy) CheckBookingConflict(w http.ResponseWriter, r *http.Request) {
	var req conflictReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.StartAt == "" || req.EndAt == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId, startAt, endAt required")
		return
	}
	start, err := utils.ParseTime(req.StartAt)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid startAt")
		return
	}
	end, err := utils.ParseTime(req.EndAt)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid endAt")
		return
	}
	conflict, count := h.hasBookingConflict(r.Context(), req.DojoID, req.ClassID, start, end)
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"conflict": conflict, "count": count})
}

func (h *Legacy) hasBookingConflict(ctx context.Context, dojoId, classId string, start, end time.Time) (bool, int) {
	q := h.clients.Firestore.Collection("bookings").Where("dojoId", "==", dojoId).Where("status", "in", []interface{}{"pending", "accepted"})
	if classId != "" {
		q = q.Where("classId", "==", classId)
	}
	// overlap condition approximated by: existing.start < new.end && existing.end > new.start
	it := q.Where("startAt", "<", end).Limit(50).Documents(ctx)
	count := 0
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		endAt, ok := snap.Data()["endAt"].(time.Time)
		if ok && endAt.After(start) {
			count++
		}
	}
	return count > 0, count
}

func (h *Legacy) GetAvailableDays(w http.ResponseWriter, r *http.Request) {
	// In your old TS code, this computed availability for amenities + bookings.
	// For the dojo app, a good next step is to store "class schedules" per dojo and compute days based on that schedule.
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"todo": "implement availability based on dojo class schedule"})
}

func (h *Legacy) GetAvailableDaysDebug(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"todo": "debug availability"})
}

type rescheduleReq struct {
	BookingID string `json:"bookingId"`
	StartAt   string `json:"startAt"`
	EndAt     string `json:"endAt"`
}

func (h *Legacy) RescheduleBooking(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	claims, _ := authctx.Claims(r.Context())

	var req rescheduleReq
	if err := httpjson.Read(r, &req); err != nil || req.BookingID == "" || req.StartAt == "" || req.EndAt == "" {
		httpjson.Error(w, http.StatusBadRequest, "bookingId, startAt, endAt required")
		return
	}
	start, err := utils.ParseTime(req.StartAt)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid startAt")
		return
	}
	end, err := utils.ParseTime(req.EndAt)
	if err != nil || !end.After(start) {
		httpjson.Error(w, http.StatusBadRequest, "invalid endAt")
		return
	}

	// Allow owner (booking user) OR staff to reschedule
	snap, err := h.clients.Firestore.Collection("bookings").Doc(req.BookingID).Get(r.Context())
	if err != nil || !snap.Exists() {
		httpjson.Error(w, http.StatusNotFound, "booking not found")
		return
	}
	data := snap.Data()
	owner, _ := data["userId"].(string)
	if owner != uid && !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "not allowed")
		return
	}

	_, err = snap.Ref.Set(r.Context(), map[string]interface{}{
		"startAt":   start,
		"endAt":     end,
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "reschedule failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *Legacy) AcceptBookingRequest(w http.ResponseWriter, r *http.Request) {
	h.updateBookingStatus(w, r, "accepted")
}

func (h *Legacy) DeclineBookingRequest(w http.ResponseWriter, r *http.Request) {
	h.updateBookingStatus(w, r, "declined")
}

func (h *Legacy) updateBookingStatus(w http.ResponseWriter, r *http.Request, status string) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req updateBookingStatusReq
	if err := httpjson.Read(r, &req); err != nil || req.BookingID == "" {
		httpjson.Error(w, http.StatusBadRequest, "bookingId required")
		return
	}
	_, err := h.clients.Firestore.Collection("bookings").Doc(req.BookingID).Set(r.Context(), map[string]interface{}{
		"status":    status,
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true, "status": status})
}

// --- Notifications & Chat ---

type findNoticesReq struct {
	DojoID string `json:"dojoId"`
	Limit  int    `json:"limit,omitempty"`
}

func (h *Legacy) FindNotificationsForBuilding(w http.ResponseWriter, r *http.Request) {
	var req findNoticesReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId required")
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	it := h.clients.Firestore.Collection("dojos").Doc(req.DojoID).Collection("notifications").
		OrderBy("createdAt", firestore.Desc).Limit(limit).Documents(r.Context())

	items := make([]map[string]interface{}, 0, limit)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		items = append(items, map[string]interface{}{"id": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

type createNoticeReq struct {
	DojoID string `json:"dojoId"`
	Title  string `json:"title"`
	Body   string `json:"body,omitempty"`
}

func (h *Legacy) CreateNotificationForBuilding(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}

	var req createNoticeReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.Title == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId and title required")
		return
	}
	now := time.Now()
	ref, _, err := h.clients.Firestore.Collection("dojos").Doc(req.DojoID).Collection("notifications").Add(r.Context(), map[string]interface{}{
		"title":     req.Title,
		"body":      req.Body,
		"createdAt": now,
		"updatedAt": now,
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "create failed")
		return
	}
	httpjson.Write(w, http.StatusCreated, map[string]interface{}{"id": ref.ID})
}

type chatReq struct {
	DojoID string `json:"dojoId"`
	Text   string `json:"text"`
}

func (h *Legacy) CreateChatMessage(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())

	var req chatReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.Text == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId and text required")
		return
	}
	now := time.Now()
	_, _, err := h.clients.Firestore.Collection("dojos").Doc(req.DojoID).Collection("chat").Add(r.Context(), map[string]interface{}{
		"uid":       uid,
		"text":      utils.TrimMax(req.Text, 2000),
		"createdAt": now,
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "create failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *Legacy) SendBookingReminders(w http.ResponseWriter, r *http.Request) {
	// In Firebase Functions TS, this was scheduled. In Go, trigger this via Cloud Scheduler hitting this endpoint.
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"todo": "send reminders (use FCM tokens + upcoming bookings)"})
}

func (h *Legacy) SendNoticeReminders(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"todo": "send notice reminders"})
}

type scheduleReminderReq struct {
	DojoID         string `json:"dojoId"`
	NotificationID string `json:"notificationId"`
	RunAt          string `json:"runAt"` // ISO datetime
}

func (h *Legacy) ScheduleNoticeReminder(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req scheduleReminderReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.NotificationID == "" || req.RunAt == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId, notificationId, runAt required")
		return
	}
	runAt, err := utils.ParseTime(req.RunAt)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid runAt")
		return
	}
	_, _, err = h.clients.Firestore.Collection("noticeReminders").Add(r.Context(), map[string]interface{}{
		"dojoId":         req.DojoID,
		"notificationId": req.NotificationID,
		"runAt":          runAt,
		"status":         "scheduled",
		"createdAt":      time.Now(),
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to schedule")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// --- Users (Auth + profile in Firestore) ---

type createUserReq struct {
	Email       string `json:"email"`
	Password    string `json:"password,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}

func (h *Legacy) CreateUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	var req createUserReq
	if err := httpjson.Read(r, &req); err != nil || req.Email == "" {
		httpjson.Error(w, http.StatusBadRequest, "email required")
		return
	}

	params := (&firebaseauth.UserToCreate{}).Email(req.Email)
	if req.Password != "" {
		params = params.Password(req.Password)
	}
	if req.DisplayName != "" {
		params = params.DisplayName(req.DisplayName)
	}

	u, err := h.clients.Auth.CreateUser(r.Context(), params)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to create user")
		return
	}
	// Create/merge user profile doc
	_, _ = h.clients.Firestore.Collection("users").Doc(u.UID).Set(r.Context(), map[string]interface{}{
		"email":       req.Email,
		"displayName": req.DisplayName,
		"createdAt":   time.Now(),
	}, firestore.MergeAll)

	httpjson.Write(w, http.StatusCreated, map[string]interface{}{"uid": u.UID})
}

type loginReq struct {
	Email string `json:"email"`
}

func (h *Legacy) LoginUser(w http.ResponseWriter, r *http.Request) {
	// WARNING: This is not a real password login. Prefer Firebase Auth client sign-in.
	var req loginReq
	if err := httpjson.Read(r, &req); err != nil || req.Email == "" {
		httpjson.Error(w, http.StatusBadRequest, "email required")
		return
	}
	u, err := h.clients.Auth.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	tok, err := h.clients.Auth.CustomToken(r.Context(), u.UID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token creation failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"customToken": tok})
}

type userReq struct {
	UID string `json:"uid,omitempty"`
}

func (h *Legacy) GetUserEmail(w http.ResponseWriter, r *http.Request) {
	var req userReq
	_ = httpjson.Read(r, &req)
	uid, _ := authctx.UID(r.Context())
	if req.UID != "" {
		uid = req.UID
	}
	u, err := h.clients.Auth.GetUser(r.Context(), uid)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"email": u.Email})
}

func (h *Legacy) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	snap, err := h.clients.Firestore.Collection("users").Doc(uid).Get(r.Context())
	if err != nil || !snap.Exists() {
		httpjson.Error(w, http.StatusNotFound, "profile not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"uid": uid, "profile": snap.Data()})
}

type updateProfileReq struct {
	DisplayName string `json:"displayName,omitempty"`
	PhotoURL    string `json:"photoUrl,omitempty"`
	Language    string `json:"language,omitempty"`
}

func (h *Legacy) UpdateUserProfile(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	var req updateProfileReq
	if err := httpjson.Read(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	updates := map[string]interface{}{}
	if req.DisplayName != "" {
		updates["displayName"] = req.DisplayName
	}
	if req.PhotoURL != "" {
		updates["photoUrl"] = req.PhotoURL
	}
	if req.Language != "" {
		updates["language"] = req.Language
	}
	updates["updatedAt"] = time.Now()

	_, err := h.clients.Firestore.Collection("users").Doc(uid).Set(r.Context(), updates, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *Legacy) GetUserBookings(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	it := h.clients.Firestore.Collection("bookings").Where("userId", "==", uid).OrderBy("startAt", firestore.Desc).Limit(50).Documents(r.Context())
	items := make([]map[string]interface{}, 0, 50)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		items = append(items, map[string]interface{}{"bookingId": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

// --- Payments history (Firestore-only) ---

func (h *Legacy) GetUserPaymentHistory(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	it := h.clients.Firestore.Collection("payments").Where("userId", "==", uid).OrderBy("createdAt", firestore.Desc).Limit(50).Documents(r.Context())
	items := make([]map[string]interface{}, 0, 50)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
		items = append(items, map[string]interface{}{"id": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (h *Legacy) GetUserBookingCount(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	// Firestore doesn't have COUNT without aggregation; keep it simple by limiting.
	it := h.clients.Firestore.Collection("bookings").Where("userId", "==", uid).Limit(1000).Documents(r.Context())
	count := 0
	for {
		_, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		count++
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"count": count})
}

func (h *Legacy) GetUserBookingHistory(w http.ResponseWriter, r *http.Request) {
	h.GetUserBookings(w, r)
}

func (h *Legacy) GetUserRole(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"claims": claims})
}

func (h *Legacy) GetUnitDetails(w http.ResponseWriter, r *http.Request) {
	// In the dojo app, "unit" becomes "dojo membership".
	uid, _ := authctx.UID(r.Context())
	var req struct {
		DojoID string `json:"dojoId"`
	}
	_ = httpjson.Read(r, &req)
	if req.DojoID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId required")
		return
	}
	snap, err := h.clients.Firestore.Collection("dojos").Doc(req.DojoID).Collection("members").Doc(uid).Get(r.Context())
	if err != nil || !snap.Exists() {
		httpjson.Error(w, http.StatusNotFound, "membership not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"membership": snap.Data()})
}

// --- FCM tokens & push ---

type fcmReq struct {
	Token string `json:"token"`
}

func (h *Legacy) AddFcmToken(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	var req fcmReq
	if err := httpjson.Read(r, &req); err != nil || req.Token == "" {
		httpjson.Error(w, http.StatusBadRequest, "token required")
		return
	}
	_, err := h.clients.Firestore.Collection("users").Doc(uid).Set(r.Context(), map[string]interface{}{
		"fcmTokens": firestore.ArrayUnion(req.Token),
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *Legacy) RemoveFcmToken(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	var req fcmReq
	if err := httpjson.Read(r, &req); err != nil || req.Token == "" {
		httpjson.Error(w, http.StatusBadRequest, "token required")
		return
	}
	_, err := h.clients.Firestore.Collection("users").Doc(uid).Set(r.Context(), map[string]interface{}{
		"fcmTokens": firestore.ArrayRemove(req.Token),
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}

type pushReq struct {
	Token string            `json:"token"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data,omitempty"`
}

func (h *Legacy) SendPushNotification(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	if h.clients.Messaging == nil {
		httpjson.Error(w, http.StatusNotImplemented, "messaging not configured")
		return
	}

	var req pushReq
	if err := httpjson.Read(r, &req); err != nil || req.Token == "" {
		httpjson.Error(w, http.StatusBadRequest, "token required")
		return
	}

	msg := &messaging.Message{
		Token: req.Token,
		Notification: &messaging.Notification{
			Title: req.Title,
			Body:  req.Body,
		},
		Data: req.Data,
	}

	id, err := h.clients.Messaging.Send(r.Context(), msg)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "send failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"messageId": id})
}

func (h *Legacy) DeleteUserAccount(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	// Delete Firestore doc first
	_, _ = h.clients.Firestore.Collection("users").Doc(uid).Delete(r.Context())
	// Delete Auth user
	if err := h.clients.Auth.DeleteUser(r.Context(), uid); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete auth user")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true})
}
