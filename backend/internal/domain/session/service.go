package session

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"dojo-manager/backend/internal/domain/dojo"
	stripedom "dojo-manager/backend/internal/domain/stripe"
)

type Service struct {
	repo      *Repo
	dojoRepo  *dojo.Repo
	stripeSvc *stripedom.Service // Add Stripe service for plan limits
}

func NewService(repo *Repo, dojoRepo *dojo.Repo) *Service {
	return &Service{repo: repo, dojoRepo: dojoRepo}
}

// SetStripeService sets the stripe service for plan limit checks
func (s *Service) SetStripeService(stripeSvc *stripedom.Service) {
	s.stripeSvc = stripeSvc
}

// Create creates a new session
func (s *Service) Create(ctx context.Context, staffUID, dojoID string, in CreateSessionInput) (*Session, error) {
	// Validate input
	if err := s.validateCreateInput(in); err != nil {
		return nil, err
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: only staff can create sessions", ErrUnauthorized)
	}

	// ★ Check plan limit before creating class
	if s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, dojoID, "class"); err != nil {
			return nil, err
		}
	}

	now := time.Now().UTC()

	// Default classType to "adult" if not specified
	classType := in.ClassType
	if classType == "" {
		classType = "adult"
	}

	// Calculate startMinute and durationMinute for frontend compatibility
	startMinute := hhmmToMinutes(in.StartTime)
	endMinute := hhmmToMinutes(in.EndTime)
	durationMinute := endMinute - startMinute
	if durationMinute < 0 {
		durationMinute = 60 // default to 60 minutes if invalid
	}

	session := Session{
		DojoID:         dojoID,
		Title:          in.Title,
		Description:    in.Description,
		DayOfWeek:      in.DayOfWeek,
		StartTime:      in.StartTime,
		EndTime:        in.EndTime,
		Instructor:     in.Instructor,
		ClassType:      classType,
		MaxCapacity:    in.MaxCapacity,
		Location:       in.Location,
		IsActive:       true,
		CreatedBy:      staffUID,
		CreatedAt:      now,
		UpdatedAt:      now,
		IsRecurring:    in.IsRecurring,
		RecurrenceRule: in.RecurrenceRule,
		// Frontend compatibility fields
		Weekday:        in.DayOfWeek,
		StartMinute:    startMinute,
		DurationMinute: durationMinute,
	}

	// Parse recurrence end date if provided
	if in.RecurrenceEnd != "" {
		endDate, err := time.Parse("2006-01-02", in.RecurrenceEnd)
		if err == nil {
			session.RecurrenceEnd = endDate
		}
	}

	return s.repo.Create(ctx, dojoID, session)
}

// Get retrieves a session by ID
func (s *Service) Get(ctx context.Context, dojoID, sessionID string) (*Session, error) {
	if dojoID == "" || sessionID == "" {
		return nil, fmt.Errorf("%w: dojoId and sessionId are required", ErrBadRequest)
	}

	return s.repo.Get(ctx, dojoID, sessionID)
}

// Update updates a session
func (s *Service) Update(ctx context.Context, staffUID, dojoID, sessionID string, in UpdateSessionInput) (*Session, error) {
	if dojoID == "" || sessionID == "" {
		return nil, fmt.Errorf("%w: dojoId and sessionId are required", ErrBadRequest)
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: only staff can update sessions", ErrUnauthorized)
	}

	// Check if session exists
	_, err = s.repo.Get(ctx, dojoID, sessionID)
	if err != nil {
		return nil, err
	}

	// Build updates map
	updates := map[string]interface{}{
		"updatedAt": time.Now().UTC(),
	}

	if in.Title != nil {
		if *in.Title == "" {
			return nil, fmt.Errorf("%w: title cannot be empty", ErrBadRequest)
		}
		updates["title"] = *in.Title
	}
	if in.Description != nil {
		updates["description"] = *in.Description
	}
	if in.DayOfWeek != nil {
		if *in.DayOfWeek < 0 || *in.DayOfWeek > 6 {
			return nil, fmt.Errorf("%w: dayOfWeek must be 0-6", ErrBadRequest)
		}
		updates["dayOfWeek"] = *in.DayOfWeek
		updates["weekday"] = *in.DayOfWeek
	}
	if in.StartTime != nil {
		if !isValidTimeFormat(*in.StartTime) {
			return nil, fmt.Errorf("%w: startTime must be HH:MM format", ErrBadRequest)
		}
		updates["startTime"] = *in.StartTime
		updates["startMinute"] = hhmmToMinutes(*in.StartTime)
	}
	if in.EndTime != nil {
		if !isValidTimeFormat(*in.EndTime) {
			return nil, fmt.Errorf("%w: endTime must be HH:MM format", ErrBadRequest)
		}
		updates["endTime"] = *in.EndTime
	}
	// Recalculate duration if both times are updated
	if in.StartTime != nil && in.EndTime != nil {
		startMin := hhmmToMinutes(*in.StartTime)
		endMin := hhmmToMinutes(*in.EndTime)
		durationMin := endMin - startMin
		if durationMin < 0 {
			durationMin = 60
		}
		updates["durationMinute"] = durationMin
	}
	if in.Instructor != nil {
		updates["instructor"] = *in.Instructor
	}
	if in.ClassType != nil {
		ct := *in.ClassType
		if ct == "" {
			ct = "adult"
		} else if !IsValidClassType(ct) {
			return nil, fmt.Errorf("%w: classType must be one of: adult, kids, mixed", ErrBadRequest)
		}
		updates["classType"] = ct
	}
	if in.MaxCapacity != nil {
		updates["maxCapacity"] = *in.MaxCapacity
	}
	if in.Location != nil {
		updates["location"] = *in.Location
	}
	if in.IsActive != nil {
		updates["isActive"] = *in.IsActive
	}
	if in.IsRecurring != nil {
		updates["isRecurring"] = *in.IsRecurring
	}
	if in.RecurrenceRule != nil {
		updates["recurrenceRule"] = *in.RecurrenceRule
	}
	if in.RecurrenceEnd != nil {
		if *in.RecurrenceEnd != "" {
			endDate, err := time.Parse("2006-01-02", *in.RecurrenceEnd)
			if err == nil {
				updates["recurrenceEnd"] = endDate
			}
		}
	}

	return s.repo.Update(ctx, dojoID, sessionID, updates)
}

// Delete deletes a session
func (s *Service) Delete(ctx context.Context, staffUID, dojoID, sessionID string) error {
	if dojoID == "" || sessionID == "" {
		return fmt.Errorf("%w: dojoId and sessionId are required", ErrBadRequest)
	}

	// Check if user is staff of the dojo
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return fmt.Errorf("%w: only staff can delete sessions", ErrUnauthorized)
	}

	// Check if session exists
	_, err = s.repo.Get(ctx, dojoID, sessionID)
	if err != nil {
		return err
	}

	return s.repo.Delete(ctx, dojoID, sessionID)
}

// List lists sessions for a dojo
func (s *Service) List(ctx context.Context, dojoID string, in ListSessionsInput) ([]Session, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	return s.repo.List(ctx, dojoID, in)
}

// ListByDay lists sessions for a specific day
func (s *Service) ListByDay(ctx context.Context, dojoID string, dayOfWeek int) ([]Session, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}
	if dayOfWeek < 0 || dayOfWeek > 6 {
		return nil, fmt.Errorf("%w: dayOfWeek must be 0-6", ErrBadRequest)
	}

	return s.repo.ListByDay(ctx, dojoID, dayOfWeek)
}

// CountClasses counts active classes in a dojo
func (s *Service) CountClasses(ctx context.Context, dojoID string) (int, error) {
	sessions, err := s.repo.List(ctx, dojoID, ListSessionsInput{ActiveOnly: true, Limit: 1000})
	if err != nil {
		return 0, err
	}
	return len(sessions), nil
}

// validateCreateInput validates the create session input
func (s *Service) validateCreateInput(in CreateSessionInput) error {
	if in.Title == "" {
		return fmt.Errorf("%w: title is required", ErrBadRequest)
	}
	if in.DayOfWeek < 0 || in.DayOfWeek > 6 {
		return fmt.Errorf("%w: dayOfWeek must be 0-6 (0=Sunday)", ErrBadRequest)
	}
	if !isValidTimeFormat(in.StartTime) {
		return fmt.Errorf("%w: startTime must be HH:MM format", ErrBadRequest)
	}
	if !isValidTimeFormat(in.EndTime) {
		return fmt.Errorf("%w: endTime must be HH:MM format", ErrBadRequest)
	}
	if in.StartTime >= in.EndTime {
		return fmt.Errorf("%w: endTime must be after startTime", ErrBadRequest)
	}
	if in.ClassType != "" && !IsValidClassType(in.ClassType) {
		return fmt.Errorf("%w: classType must be one of: adult, kids, mixed", ErrBadRequest)
	}
	return nil
}

// isValidTimeFormat checks if the time string is in HH:MM format
var timeFormatRegex = regexp.MustCompile(`^([01]?[0-9]|2[0-3]):[0-5][0-9]$`)

func isValidTimeFormat(t string) bool {
	return timeFormatRegex.MatchString(t)
}

// hhmmToMinutes converts "HH:MM" string to minutes from midnight
func hhmmToMinutes(hhmm string) int {
	if len(hhmm) < 4 {
		return 0
	}
	var h, m int
	_, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m)
	if err != nil {
		return 0
	}
	return h*60 + m
}
