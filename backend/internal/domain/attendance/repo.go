package attendance

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Repo struct {
	client *firestore.Client
}

func NewRepo(client *firestore.Client) *Repo {
	return &Repo{client: client}
}

func (r *Repo) attendanceCol(dojoID string) *firestore.CollectionRef {
	return r.client.Collection("dojos").Doc(dojoID).Collection("attendance")
}

// Create creates a new attendance record
func (r *Repo) Create(ctx context.Context, dojoID string, att Attendance) (*Attendance, error) {
	col := r.attendanceCol(dojoID)
	ref, _, err := col.Add(ctx, map[string]interface{}{
		"dojoId":            att.DojoID,
		"sessionInstanceId": att.SessionInstanceID,
		"memberUid":         att.MemberUID,
		"status":            att.Status,
		"notes":             att.Notes,
		"checkInTime":       att.CheckInTime,
		"recordedBy":        att.RecordedBy,
		"createdAt":         att.CreatedAt,
		"updatedAt":         att.UpdatedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create attendance: %w", err)
	}
	att.ID = ref.ID
	return &att, nil
}

// Get retrieves an attendance record by ID
func (r *Repo) Get(ctx context.Context, dojoID, attendanceID string) (*Attendance, error) {
	doc, err := r.attendanceCol(dojoID).Doc(attendanceID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: attendance not found", ErrNotFound)
	}

	var att Attendance
	if err := doc.DataTo(&att); err != nil {
		return nil, fmt.Errorf("failed to decode attendance: %w", err)
	}
	att.ID = doc.Ref.ID
	return &att, nil
}

// Update updates an attendance record
func (r *Repo) Update(ctx context.Context, dojoID, attendanceID string, updates map[string]interface{}) (*Attendance, error) {
	ref := r.attendanceCol(dojoID).Doc(attendanceID)
	_, err := ref.Set(ctx, updates, firestore.MergeAll)
	if err != nil {
		return nil, fmt.Errorf("failed to update attendance: %w", err)
	}

	return r.Get(ctx, dojoID, attendanceID)
}

// FindExisting finds an existing attendance record for a member in a session instance
func (r *Repo) FindExisting(ctx context.Context, dojoID, sessionInstanceID, memberUID string) (*Attendance, error) {
	iter := r.attendanceCol(dojoID).
		Where("sessionInstanceId", "==", sessionInstanceID).
		Where("memberUid", "==", memberUID).
		Limit(1).
		Documents(ctx)

	doc, err := iter.Next()
	if err == iterator.Done {
		return nil, nil // Not found, but not an error
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find attendance: %w", err)
	}

	var att Attendance
	if err := doc.DataTo(&att); err != nil {
		return nil, fmt.Errorf("failed to decode attendance: %w", err)
	}
	att.ID = doc.Ref.ID
	return &att, nil
}

// List lists attendance records
func (r *Repo) List(ctx context.Context, dojoID string, input ListAttendanceInput) ([]Attendance, error) {
	query := r.attendanceCol(dojoID).Query

	if input.SessionInstanceID != "" {
		query = query.Where("sessionInstanceId", "==", input.SessionInstanceID)
	}
	if input.MemberUID != "" {
		query = query.Where("memberUid", "==", input.MemberUID)
	}

	query = query.OrderBy("createdAt", firestore.Desc)

	limit := input.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query = query.Limit(limit)

	iter := query.Documents(ctx)
	var records []Attendance

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list attendance: %w", err)
		}

		var att Attendance
		if err := doc.DataTo(&att); err != nil {
			continue
		}
		att.ID = doc.Ref.ID
		records = append(records, att)
	}

	return records, nil
}

// BulkUpsert performs bulk upsert for attendance records
func (r *Repo) BulkUpsert(ctx context.Context, dojoID, sessionInstanceID, recordedBy string, records []BulkAttendanceRecord) ([]map[string]interface{}, error) {
	batch := r.client.Batch()
	results := make([]map[string]interface{}, 0, len(records))
	now := time.Now().UTC()

	for _, record := range records {
		if record.MemberUID == "" || !IsValidStatus(record.Status) {
			continue
		}

		// Check for existing record
		existing, _ := r.FindExisting(ctx, dojoID, sessionInstanceID, record.MemberUID)

		notes := record.Notes
		if len(notes) > 500 {
			notes = notes[:500]
		}

		if existing != nil {
			// Update existing
			ref := r.attendanceCol(dojoID).Doc(existing.ID)
			batch.Set(ref, map[string]interface{}{
				"status":     record.Status,
				"notes":      notes,
				"updatedAt":  now,
				"recordedBy": recordedBy,
			}, firestore.MergeAll)
			results = append(results, map[string]interface{}{
				"memberUid": record.MemberUID,
				"action":    "updated",
			})
		} else {
			// Create new
			ref := r.attendanceCol(dojoID).NewDoc()
			var checkInTime *time.Time
			if record.Status == "present" || record.Status == "late" {
				checkInTime = &now
			}
			batch.Set(ref, map[string]interface{}{
				"dojoId":            dojoID,
				"sessionInstanceId": sessionInstanceID,
				"memberUid":         record.MemberUID,
				"status":            record.Status,
				"notes":             notes,
				"checkInTime":       checkInTime,
				"recordedBy":        recordedBy,
				"createdAt":         now,
				"updatedAt":         now,
			})
			results = append(results, map[string]interface{}{
				"memberUid": record.MemberUID,
				"action":    "created",
			})
		}
	}

	if _, err := batch.Commit(ctx); err != nil {
		return nil, fmt.Errorf("batch commit failed: %w", err)
	}

	return results, nil
}
