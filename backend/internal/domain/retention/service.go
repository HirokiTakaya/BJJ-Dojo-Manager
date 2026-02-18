package retention

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"

	"dojo-manager/backend/internal/domain/dojo"
)

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

type Service struct {
	fs       *firestore.Client
	dojoRepo *dojo.Repo
}

func NewService(fs *firestore.Client, dojoRepo *dojo.Repo) *Service {
	return &Service{fs: fs, dojoRepo: dojoRepo}
}

// ─────────────────────────────────────────────
// Settings CRUD
// ─────────────────────────────────────────────

func (s *Service) settingsRef(dojoID string) *firestore.DocumentRef {
	return s.fs.Collection("dojos").Doc(dojoID).Collection("settings").Doc("retention")
}

// GetSettings loads retention settings, returns defaults if not set
func (s *Service) GetSettings(ctx context.Context, dojoID string) (RetentionSettings, error) {
	doc, err := s.settingsRef(dojoID).Get(ctx)
	if err != nil {
		// Document doesn't exist → return defaults
		return DefaultSettings(), nil
	}

	var settings RetentionSettings
	if err := doc.DataTo(&settings); err != nil {
		return DefaultSettings(), nil
	}

	// Fill in missing defaults
	if settings.ThresholdDays <= 0 {
		settings.ThresholdDays = 10
	}
	if settings.CriticalMultiplier <= 0 {
		settings.CriticalMultiplier = 2.0
	}
	if settings.WatchRatio <= 0 {
		settings.WatchRatio = 0.7
	}

	return settings, nil
}

// UpdateSettings updates retention settings
func (s *Service) UpdateSettings(ctx context.Context, staffUID, dojoID string, input UpdateSettingsInput) (RetentionSettings, error) {
	if dojoID == "" {
		return RetentionSettings{}, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	// Check staff permission
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return RetentionSettings{}, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return RetentionSettings{}, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// Validate
	if input.ThresholdDays != nil && *input.ThresholdDays < 1 {
		return RetentionSettings{}, fmt.Errorf("%w: thresholdDays must be >= 1", ErrBadRequest)
	}
	if input.CriticalMultiplier != nil && *input.CriticalMultiplier < 1.0 {
		return RetentionSettings{}, fmt.Errorf("%w: criticalMultiplier must be >= 1.0", ErrBadRequest)
	}
	if input.WatchRatio != nil && (*input.WatchRatio < 0.1 || *input.WatchRatio > 1.0) {
		return RetentionSettings{}, fmt.Errorf("%w: watchRatio must be between 0.1 and 1.0", ErrBadRequest)
	}

	// Load current, merge updates
	current, _ := s.GetSettings(ctx, dojoID)

	if input.ThresholdDays != nil {
		current.ThresholdDays = *input.ThresholdDays
	}
	if input.CriticalMultiplier != nil {
		current.CriticalMultiplier = *input.CriticalMultiplier
	}
	if input.WatchRatio != nil {
		current.WatchRatio = *input.WatchRatio
	}
	if input.EmailEnabled != nil {
		current.EmailEnabled = *input.EmailEnabled
	}
	current.UpdatedAt = time.Now().UTC()
	current.UpdatedBy = staffUID

	_, err = s.settingsRef(dojoID).Set(ctx, current)
	if err != nil {
		return RetentionSettings{}, fmt.Errorf("failed to save settings: %w", err)
	}

	return current, nil
}

// ─────────────────────────────────────────────
// Alerts Scan
// ─────────────────────────────────────────────

// memberInfo holds member data from Firestore
type memberInfo struct {
	UID         string
	DisplayName string
	Email       string
	BeltRank    string
	Stripes     int
	IsKids      bool
	RoleInDojo  string
}

// attendanceSummary tracks each member's latest attendance
type attendanceSummary struct {
	LastDate     string // "YYYY-MM-DD"
	LastTitle    string
	TotalCount   int
}

// staffRoles that should be excluded from retention alerts
var staffRoles = map[string]bool{
	"owner": true, "staff": true, "coach": true, "admin": true, "instructor": true,
}

// GetAlerts scans attendance data and returns at-risk members
func (s *Service) GetAlerts(ctx context.Context, staffUID, dojoID string) (*AlertsSummary, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	// Check staff permission
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// Load settings
	settings, err := s.GetSettings(ctx, dojoID)
	if err != nil {
		return nil, err
	}

	// 1. Load all members (students only)
	members, err := s.loadStudentMembers(ctx, dojoID)
	if err != nil {
		return nil, err
	}

	memberUIDs := make(map[string]bool, len(members))
	for _, m := range members {
		memberUIDs[m.UID] = true
	}

	// 2. Scan attendance across all sessions
	attMap, err := s.scanAttendance(ctx, dojoID, memberUIDs)
	if err != nil {
		return nil, err
	}

	// 3. Compute alerts
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	_ = today

	watchThreshold := int(math.Floor(float64(settings.ThresholdDays) * settings.WatchRatio))
	criticalThreshold := int(math.Floor(float64(settings.ThresholdDays) * settings.CriticalMultiplier))

	var alerts []MemberAlert
	stats := AlertStats{TotalMembers: len(members)}

	for _, m := range members {
		att := attMap[m.UID]
		var daysSince int

		if att.LastDate == "" {
			daysSince = -1 // never attended
		} else {
			daysSince = daysBetween(att.LastDate, now)
		}

		// Skip members who are attending regularly
		if daysSince >= 0 && daysSince < watchThreshold {
			continue
		}

		// Determine risk level
		var risk RiskLevel
		if daysSince < 0 {
			risk = RiskCritical // never attended
		} else if daysSince >= criticalThreshold {
			risk = RiskCritical
		} else if daysSince >= settings.ThresholdDays {
			risk = RiskWarning
		} else {
			risk = RiskWatch
		}

		alert := MemberAlert{
			MemberUID:                m.UID,
			DisplayName:              m.DisplayName,
			Email:                    m.Email,
			BeltRank:                 m.BeltRank,
			Stripes:                  m.Stripes,
			IsKids:                   m.IsKids,
			LastAttendedDate:         att.LastDate,
			LastAttendedSessionTitle:  att.LastTitle,
			DaysSinceLastAttendance:  daysSince,
			TotalSessions:            att.TotalCount,
			RiskLevel:                risk,
		}

		alerts = append(alerts, alert)

		switch risk {
		case RiskCritical:
			stats.Critical++
		case RiskWarning:
			stats.Warning++
		case RiskWatch:
			stats.Watch++
		}
	}

	stats.TotalAtRisk = len(alerts)

	// Sort: critical first, then by days descending
	sort.Slice(alerts, func(i, j int) bool {
		ri := riskOrder(alerts[i].RiskLevel)
		rj := riskOrder(alerts[j].RiskLevel)
		if ri != rj {
			return ri < rj
		}
		// Within same risk: more days first (never=-1 should be top)
		di := alerts[i].DaysSinceLastAttendance
		dj := alerts[j].DaysSinceLastAttendance
		if di < 0 {
			di = 99999
		}
		if dj < 0 {
			dj = 99999
		}
		return di > dj
	})

	return &AlertsSummary{
		DojoID:    dojoID,
		Settings:  settings,
		Alerts:    alerts,
		Stats:     stats,
		ScannedAt: now,
	}, nil
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

func (s *Service) loadStudentMembers(ctx context.Context, dojoID string) ([]memberInfo, error) {
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Documents(ctx)
	defer iter.Stop()

	var members []memberInfo
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list members: %w", err)
		}

		data := doc.Data()

		// Skip staff roles
		role := stringVal(data, "roleInDojo")
		if role == "" {
			role = stringVal(data, "role")
		}
		if staffRoles[role] {
			continue
		}

		// Skip inactive/rejected members
		status := stringVal(data, "status")
		if status == "rejected" || status == "removed" || status == "banned" {
			continue
		}

		displayName := stringVal(data, "displayName")
		if displayName == "" {
			displayName = stringVal(data, "email")
		}
		if displayName == "" {
			displayName = doc.Ref.ID[:8] + "..."
		}

		members = append(members, memberInfo{
			UID:         doc.Ref.ID,
			DisplayName: displayName,
			Email:       stringVal(data, "email"),
			BeltRank:    stringValDefault(data, "beltRank", "white"),
			Stripes:     intVal(data, "stripes"),
			IsKids:      boolVal(data, "isKids"),
			RoleInDojo:  role,
		})
	}

	return members, nil
}

// scanAttendance scans all sessions' attendance subcollections
// and also the dojo-level attendance collection
func (s *Service) scanAttendance(ctx context.Context, dojoID string, memberUIDs map[string]bool) (map[string]attendanceSummary, error) {
	result := make(map[string]attendanceSummary)

	// Initialize for all members
	for uid := range memberUIDs {
		result[uid] = attendanceSummary{}
	}

	// --- Method 1: Scan dojo-level attendance collection ---
	// (dojos/{dojoId}/attendance where sessionInstanceId contains date)
	if err := s.scanDojoLevelAttendance(ctx, dojoID, memberUIDs, result); err != nil {
		// Non-fatal, continue to method 2
		_ = err
	}

	// --- Method 2: Scan session-level attendance subcollections ---
	// (dojos/{dojoId}/sessions/{sessionId}/attendance)
	if err := s.scanSessionLevelAttendance(ctx, dojoID, memberUIDs, result); err != nil {
		// Non-fatal if method 1 had some data
		_ = err
	}

	return result, nil
}

// scanDojoLevelAttendance scans dojos/{dojoId}/attendance
func (s *Service) scanDojoLevelAttendance(ctx context.Context, dojoID string, memberUIDs map[string]bool, result map[string]attendanceSummary) error {
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("attendance").
		OrderBy("createdAt", firestore.Desc).
		Limit(5000).
		Documents(ctx)
	defer iter.Stop()

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
		}

		data := doc.Data()
		uid := stringVal(data, "memberUid")
		if !memberUIDs[uid] {
			continue
		}

		status := stringVal(data, "status")
		if status != "present" && status != "late" {
			continue
		}

		// Extract date from sessionInstanceId (e.g., "2025-01-15__classId")
		sessionInstanceID := stringVal(data, "sessionInstanceId")
		dateKey := extractDateFromSessionInstance(sessionInstanceID)

		// Also try createdAt
		if dateKey == "" {
			if t, ok := data["createdAt"].(time.Time); ok {
				dateKey = t.Format("2006-01-02")
			}
		}

		existing := result[uid]
		existing.TotalCount++
		if dateKey != "" && dateKey > existing.LastDate {
			existing.LastDate = dateKey
		}
		result[uid] = existing
	}

	return nil
}

// scanSessionLevelAttendance scans dojos/{dojoId}/sessions/*/attendance
func (s *Service) scanSessionLevelAttendance(ctx context.Context, dojoID string, memberUIDs map[string]bool, result map[string]attendanceSummary) error {
	sessIter := s.fs.Collection("dojos").Doc(dojoID).Collection("sessions").Documents(ctx)
	defer sessIter.Stop()

	for {
		sessDoc, err := sessIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
		}

		sessData := sessDoc.Data()
		dateKey := stringVal(sessData, "dateKey")
		sessionTitle := stringVal(sessData, "title")

		// If no dateKey, try to extract from session ID (e.g., "2025-01-15__classId")
		if dateKey == "" {
			dateKey = extractDateFromSessionInstance(sessDoc.Ref.ID)
		}

		// Scan attendance subcollection
		attIter := sessDoc.Ref.Collection("attendance").Documents(ctx)
		for {
			attDoc, err := attIter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				break
			}

			uid := attDoc.Ref.ID
			if !memberUIDs[uid] {
				// Also check memberUid field
				attData := attDoc.Data()
				uid = stringVal(attData, "uid")
				if uid == "" {
					uid = stringVal(attData, "memberUid")
				}
				if !memberUIDs[uid] {
					continue
				}
			}

			attData := attDoc.Data()
			status := stringVal(attData, "status")
			if status != "present" && status != "late" {
				continue
			}

			existing := result[uid]
			existing.TotalCount++
			if dateKey != "" && dateKey > existing.LastDate {
				existing.LastDate = dateKey
				existing.LastTitle = sessionTitle
			}
			result[uid] = existing
		}
		attIter.Stop()
	}

	return nil
}

// ─────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────

func extractDateFromSessionInstance(id string) string {
	// Expect format "YYYY-MM-DD__classId" or "YYYY-MM-DD"
	if len(id) < 10 {
		return ""
	}
	candidate := id[:10]
	// Quick validation: YYYY-MM-DD
	if len(candidate) == 10 && candidate[4] == '-' && candidate[7] == '-' {
		return candidate
	}
	return ""
}

func daysBetween(dateStr string, now time.Time) int {
	t, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return -1
	}
	diff := now.Sub(t)
	return int(diff.Hours() / 24)
}

func riskOrder(r RiskLevel) int {
	switch r {
	case RiskCritical:
		return 0
	case RiskWarning:
		return 1
	case RiskWatch:
		return 2
	default:
		return 3
	}
}

func stringVal(data map[string]interface{}, key string) string {
	if v, ok := data[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func stringValDefault(data map[string]interface{}, key, def string) string {
	s := stringVal(data, key)
	if s == "" {
		return def
	}
	return s
}

func intVal(data map[string]interface{}, key string) int {
	if v, ok := data[key]; ok {
		switch n := v.(type) {
		case int64:
			return int(n)
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return 0
}

func boolVal(data map[string]interface{}, key string) bool {
	if v, ok := data[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}