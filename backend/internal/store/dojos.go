package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"

	"dojo-manager/backend/internal/models"
	"dojo-manager/backend/internal/utils"
)

var (
	ErrForbidden            = errors.New("forbidden")
	ErrNotFound             = errors.New("not found")
	ErrAlreadyMember        = errors.New("already a member")
	ErrAlreadyRequested     = errors.New("already requested")
	ErrLastStaffCannotLeave = errors.New("last staff cannot leave")
	ErrInvalidJoinMode      = errors.New("invalid joinMode")
)

const (
	ColDojos = "dojos"
	ColUsers = "users"
)

type Store struct {
	FS *firestore.Client
}

func New(fs *firestore.Client) *Store {
	return &Store{FS: fs}
}

func (s *Store) CreateDojo(ctx context.Context, uid, displayName, name, city, country, joinMode string) (models.Dojo, error) {
	if joinMode == "" {
		joinMode = "request"
	}
	if joinMode != "open" && joinMode != "request" {
		return models.Dojo{}, ErrInvalidJoinMode
	}

	nameLower := utils.NormalizeNameLower(name)
	slug := utils.Slugify(name)
	if nameLower == "" || slug == "" {
		return models.Dojo{}, fmt.Errorf("invalid dojo name")
	}

	now := time.Now()

	dojoDoc := s.FS.Collection(ColDojos).NewDoc()
	dojoID := dojoDoc.ID

	dojo := map[string]any{
		"name":         name,
		"nameLower":    nameLower,
		"slug":         slug,
		"keywords":     utils.KeywordsFromName(nameLower, slug),
		"joinMode":     joinMode,
		"createdByUid": uid,
		"createdAt":    firestore.ServerTimestamp,
		"updatedAt":    firestore.ServerTimestamp,
		"active":       true,
		"city":         city,
		"country":      country,
	}

	member := map[string]any{
		"uid":          uid,
		"role":         "staff",
		"status":       "active",
		"joinedAt":     firestore.ServerTimestamp,
		"createdAt":    firestore.ServerTimestamp,
		"createdByUid": uid,
		"displayName":  displayName,
	}

	index := map[string]any{
		"dojoId":    dojoID,
		"role":      "staff",
		"status":    "active",
		"joinedAt":  firestore.ServerTimestamp,
		"dojoName":  name,
		"dojoSlug":  slug,
		"updatedAt": firestore.ServerTimestamp,
	}

	batch := s.FS.Batch()
	batch.Create(dojoDoc, dojo)
	batch.Set(dojoDoc.Collection("members").Doc(uid), member)
	batch.Set(s.FS.Collection(ColUsers).Doc(uid).Collection("dojoMemberships").Doc(dojoID), index)

	_, err := batch.Commit(ctx)
	if err != nil {
		return models.Dojo{}, err
	}

	return models.Dojo{
		ID:           dojoID,
		Name:         name,
		NameLower:    nameLower,
		Slug:         slug,
		JoinMode:     joinMode,
		CreatedByUID: uid,
		CreatedAt:    now,
		UpdatedAt:    now,
		Active:       true,
		City:         city,
		Country:      country,
	}, nil
}

func (s *Store) SearchDojos(ctx context.Context, q string, limit int) ([]models.Dojo, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	q = utils.NormalizeNameLower(q)

	col := s.FS.Collection(ColDojos)
	var iter *firestore.DocumentIterator

	if q == "" {
		iter = col.Where("active", "==", true).OrderBy("nameLower", firestore.Asc).Limit(limit).Documents(ctx)
	} else {
		end := q + "\uf8ff"
		iter = col.Where("active", "==", true).
			OrderBy("nameLower", firestore.Asc).
			StartAt(q).
			EndAt(end).
			Limit(limit).
			Documents(ctx)
	}

	docs, err := iter.GetAll()
	if err != nil {
		return nil, err
	}

	out := make([]models.Dojo, 0, len(docs))
	for _, d := range docs {
		var dojo models.Dojo
		if err := d.DataTo(&dojo); err != nil {
			continue
		}
		dojo.ID = d.Ref.ID
		out = append(out, dojo)
	}
	return out, nil
}

func (s *Store) GetDojo(ctx context.Context, dojoID string) (map[string]any, error) {
	snap, err := s.FS.Collection(ColDojos).Doc(dojoID).Get(ctx)
	if err != nil {
		return nil, ErrNotFound
	}
	return snap.Data(), nil
}

func (s *Store) GetMember(ctx context.Context, dojoID, uid string) (map[string]any, error) {
	snap, err := s.FS.Collection(ColDojos).Doc(dojoID).Collection("members").Doc(uid).Get(ctx)
	if err != nil {
		return nil, ErrNotFound
	}
	return snap.Data(), nil
}

func (s *Store) IsStaff(ctx context.Context, dojoID, uid string) (bool, error) {
	m, err := s.GetMember(ctx, dojoID, uid)
	if err != nil {
		return false, err
	}
	role, _ := m["role"].(string)
	status, _ := m["status"].(string)
	return role == "staff" && status == "active", nil
}

func (s *Store) CreateJoinRequest(ctx context.Context, dojoID, uid, displayName, email, message string) (string, error) {
	dojo, err := s.GetDojo(ctx, dojoID)
	if err != nil {
		return "", err
	}
	joinMode, _ := dojo["joinMode"].(string)
	if joinMode == "" {
		joinMode = "request"
	}

	if _, err := s.GetMember(ctx, dojoID, uid); err == nil {
		return "", ErrAlreadyMember
	}

	jrRef := s.FS.Collection(ColDojos).Doc(dojoID).Collection("joinRequests").Doc(uid)

	if joinMode == "open" {
		return "joined", s.AddMember(ctx, dojoID, uid, "student", displayName, "")
	}

	_, err = jrRef.Get(ctx)
	if err == nil {
		return "", ErrAlreadyRequested
	}

	data := map[string]any{
		"uid":            uid,
		"dojoId":         dojoID,
		"status":         "pending",
		"message":        message,
		"createdAt":      firestore.ServerTimestamp,
		"requestedByUid": uid,
		"displayName":    displayName,
		"email":          email,
	}

	_, err = jrRef.Create(ctx, data)
	if err != nil {
		return "", err
	}
	return "requested", nil
}

func (s *Store) AddMember(ctx context.Context, dojoID, uid, role, displayName, createdByUID string) error {
	if role == "" {
		role = "student"
	}
	if createdByUID == "" {
		createdByUID = uid
	}

	dojoSnap, err := s.FS.Collection(ColDojos).Doc(dojoID).Get(ctx)
	if err != nil {
		return ErrNotFound
	}
	dojo := dojoSnap.Data()
	dojoName, _ := dojo["name"].(string)
	dojoSlug, _ := dojo["slug"].(string)

	memberRef := s.FS.Collection(ColDojos).Doc(dojoID).Collection("members").Doc(uid)
	indexRef := s.FS.Collection(ColUsers).Doc(uid).Collection("dojoMemberships").Doc(dojoID)

	batch := s.FS.Batch()
	batch.Set(memberRef, map[string]any{
		"uid":          uid,
		"role":         role,
		"status":       "active",
		"joinedAt":     firestore.ServerTimestamp,
		"createdAt":    firestore.ServerTimestamp,
		"createdByUid": createdByUID,
		"displayName":  displayName,
	}, firestore.MergeAll)

	batch.Set(indexRef, map[string]any{
		"dojoId":    dojoID,
		"role":      role,
		"status":    "active",
		"joinedAt":  firestore.ServerTimestamp,
		"dojoName":  dojoName,
		"dojoSlug":  dojoSlug,
		"updatedAt": firestore.ServerTimestamp,
	}, firestore.MergeAll)

	_, err = batch.Commit(ctx)
	return err
}

func (s *Store) ListJoinRequests(ctx context.Context, dojoID string, limit int) ([]models.JoinRequest, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	iter := s.FS.Collection(ColDojos).Doc(dojoID).Collection("joinRequests").
		Where("status", "==", "pending").
		OrderBy("createdAt", firestore.Desc).
		Limit(limit).
		Documents(ctx)

	docs, err := iter.GetAll()
	if err != nil {
		return nil, err
	}

	out := make([]models.JoinRequest, 0, len(docs))
	for _, d := range docs {
		var jr models.JoinRequest
		if err := d.DataTo(&jr); err != nil {
			continue
		}
		out = append(out, jr)
	}
	return out, nil
}

func (s *Store) ApproveJoinRequest(ctx context.Context, dojoID, staffUID, targetUID, displayName string) error {
	jrRef := s.FS.Collection(ColDojos).Doc(dojoID).Collection("joinRequests").Doc(targetUID)
	_, err := jrRef.Get(ctx)
	if err != nil {
		return ErrNotFound
	}

	batch := s.FS.Batch()

	memberRef := s.FS.Collection(ColDojos).Doc(dojoID).Collection("members").Doc(targetUID)
	batch.Set(memberRef, map[string]any{
		"uid":          targetUID,
		"role":         "student",
		"status":       "active",
		"joinedAt":     firestore.ServerTimestamp,
		"createdAt":    firestore.ServerTimestamp,
		"createdByUid": staffUID,
		"displayName":  displayName,
	}, firestore.MergeAll)

	dojoSnap, err := s.FS.Collection(ColDojos).Doc(dojoID).Get(ctx)
	if err != nil {
		return ErrNotFound
	}
	dojo := dojoSnap.Data()
	dojoName, _ := dojo["name"].(string)
	dojoSlug, _ := dojo["slug"].(string)

	idxRef := s.FS.Collection(ColUsers).Doc(targetUID).Collection("dojoMemberships").Doc(dojoID)
	batch.Set(idxRef, map[string]any{
		"dojoId":    dojoID,
		"role":      "student",
		"status":    "active",
		"joinedAt":  firestore.ServerTimestamp,
		"dojoName":  dojoName,
		"dojoSlug":  dojoSlug,
		"updatedAt": firestore.ServerTimestamp,
	}, firestore.MergeAll)

	batch.Delete(jrRef)

	_, err = batch.Commit(ctx)
	return err
}

func (s *Store) RejectJoinRequest(ctx context.Context, dojoID, targetUID string) error {
	jrRef := s.FS.Collection(ColDojos).Doc(dojoID).Collection("joinRequests").Doc(targetUID)
	_, err := jrRef.Get(ctx)
	if err != nil {
		return ErrNotFound
	}
	_, err = jrRef.Delete(ctx)
	return err
}

func (s *Store) ListMyDojos(ctx context.Context, uid string, limit int) ([]models.UserDojoIndex, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	iter := s.FS.Collection(ColUsers).Doc(uid).Collection("dojoMemberships").
		OrderBy("updatedAt", firestore.Desc).
		Limit(limit).
		Documents(ctx)

	docs, err := iter.GetAll()
	if err != nil {
		return nil, err
	}

	out := make([]models.UserDojoIndex, 0, len(docs))
	for _, d := range docs {
		var idx models.UserDojoIndex
		if err := d.DataTo(&idx); err != nil {
			continue
		}
		out = append(out, idx)
	}
	return out, nil
}

func (s *Store) LeaveDojo(ctx context.Context, dojoID, uid string) error {
	dojoRef := s.FS.Collection(ColDojos).Doc(dojoID)
	memberRef := dojoRef.Collection("members").Doc(uid)
	memberSnap, err := memberRef.Get(ctx)
	if err != nil {
		return ErrNotFound
	}
	role, _ := memberSnap.Data()["role"].(string)
	status, _ := memberSnap.Data()["status"].(string)

	if status != "active" {
		_, _ = memberRef.Delete(ctx)
		_, _ = s.FS.Collection(ColUsers).Doc(uid).Collection("dojoMemberships").Doc(dojoID).Delete(ctx)
		return nil
	}

	if role == "staff" {
		iter := dojoRef.Collection("members").
			Where("role", "==", "staff").
			Where("status", "==", "active").
			Limit(2).
			Documents(ctx)

		docs, err := iter.GetAll()
		if err != nil {
			return err
		}
		if len(docs) <= 1 {
			return ErrLastStaffCannotLeave
		}
	}

	batch := s.FS.Batch()
	batch.Delete(memberRef)
	batch.Delete(s.FS.Collection(ColUsers).Doc(uid).Collection("dojoMemberships").Doc(dojoID))
	_, err = batch.Commit(ctx)
	return err
}

func (s *Store) UpdateDojoSettings(ctx context.Context, dojoID, uid, joinMode string) error {
	if joinMode != "" && joinMode != "open" && joinMode != "request" {
		return ErrInvalidJoinMode
	}
	data := map[string]any{
		"updatedAt": firestore.ServerTimestamp,
	}
	if joinMode != "" {
		data["joinMode"] = joinMode
	}
	_, err := s.FS.Collection(ColDojos).Doc(dojoID).Set(ctx, data, firestore.MergeAll)
	return err
}
