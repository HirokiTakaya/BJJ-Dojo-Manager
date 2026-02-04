package attendance

import (
	"context"
	"fmt"
	"time"

	"dojo-manager/backend/internal/domain/dojo"
)

type Service struct {
	repo     *Repo
	dojoRepo *dojo.Repo
}

func NewService(repo *Repo, dojoRepo *dojo.Repo) *Service {
	return &Service{repo: repo, dojoRepo: dojoRepo}
}

// Record creates or updates an attendance record
func (s *Service) Record(ctx context.Context, staffUID string, input RecordAttendanceInput) (*Attendance, error) {
	input.Trim()

	// Validate input
	if input.DojoID == "" || input.SessionInstanceID == "" || input.MemberUID == "" || input.Status == "" {
		return nil, fmt.Errorf("%w: dojoId, sessionInstanceId, memberUid, status are required", ErrBadRequest)
	}

	if !IsValidStatus(input.Status) {
		return nil, fmt.Errorf("%w: status must be one of: present, absent, late, excused", ErrBadRequest)
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	now := time.Now().UTC()

	// Check for existing record
	existing, _ := s.repo.FindExisting(ctx, input.DojoID, input.SessionInstanceID, input.MemberUID)

	if existing != nil {
		// Update existing record
		updates := map[string]interface{}{
			"status":     input.Status,
			"notes":      input.Notes,
			"updatedAt":  now,
			"recordedBy": staffUID,
		}
		return s.repo.Update(ctx, input.DojoID, existing.ID, updates)
	}

	// Create new record
	var checkInTime *time.Time
	if input.Status == "present" || input.Status == "late" {
		checkInTime = &now
	}

	att := Attendance{
		DojoID:            input.DojoID,
		SessionInstanceID: input.SessionInstanceID,
		MemberUID:         input.MemberUID,
		Status:            AttendanceStatus(input.Status),
		Notes:             input.Notes,
		CheckInTime:       checkInTime,
		RecordedBy:        staffUID,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	return s.repo.Create(ctx, input.DojoID, att)
}

// Update updates an attendance record
func (s *Service) Update(ctx context.Context, staffUID string, input UpdateAttendanceInput) (*Attendance, error) {
	input.Trim()

	if input.DojoID == "" || input.ID == "" {
		return nil, fmt.Errorf("%w: dojoId and id are required", ErrBadRequest)
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// Check if record exists
	_, err = s.repo.Get(ctx, input.DojoID, input.ID)
	if err != nil {
		return nil, err
	}

	updates := map[string]interface{}{
		"updatedAt":  time.Now().UTC(),
		"recordedBy": staffUID,
	}

	if input.Status != nil {
		if !IsValidStatus(*input.Status) {
			return nil, fmt.Errorf("%w: status must be one of: present, absent, late, excused", ErrBadRequest)
		}
		updates["status"] = *input.Status
	}

	if input.Notes != nil {
		updates["notes"] = *input.Notes
	}

	return s.repo.Update(ctx, input.DojoID, input.ID, updates)
}

// List lists attendance records
func (s *Service) List(ctx context.Context, input ListAttendanceInput) ([]Attendance, error) {
	if input.DojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	return s.repo.List(ctx, input.DojoID, input)
}

// BulkRecord performs bulk attendance recording
func (s *Service) BulkRecord(ctx context.Context, staffUID string, input BulkAttendanceInput) ([]map[string]interface{}, error) {
	if input.DojoID == "" || input.SessionInstanceID == "" || len(input.Records) == 0 {
		return nil, fmt.Errorf("%w: dojoId, sessionInstanceId, records[] are required", ErrBadRequest)
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	return s.repo.BulkUpsert(ctx, input.DojoID, input.SessionInstanceID, staffUID, input.Records)
}
