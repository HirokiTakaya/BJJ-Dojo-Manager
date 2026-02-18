package retention

import (
	"errors"
	"time"
)

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

var (
	ErrBadRequest   = errors.New("bad request")
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not found")
)

func IsErrBadRequest(err error) bool   { return errors.Is(err, ErrBadRequest) }
func IsErrUnauthorized(err error) bool { return errors.Is(err, ErrUnauthorized) }
func IsErrNotFound(err error) bool     { return errors.Is(err, ErrNotFound) }

// ─────────────────────────────────────────────
// Risk Levels
// ─────────────────────────────────────────────

type RiskLevel string

const (
	RiskCritical RiskLevel = "critical"
	RiskWarning  RiskLevel = "warning"
	RiskWatch    RiskLevel = "watch"
)

// ─────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────

// RetentionSettings holds dojo-level retention configuration
type RetentionSettings struct {
	ThresholdDays      int       `firestore:"thresholdDays" json:"thresholdDays"`
	CriticalMultiplier float64   `firestore:"criticalMultiplier" json:"criticalMultiplier"` // e.g. 2.0 = 2x threshold
	WatchRatio         float64   `firestore:"watchRatio" json:"watchRatio"`                 // e.g. 0.7 = 70% of threshold
	EmailEnabled       bool      `firestore:"emailEnabled" json:"emailEnabled"`
	UpdatedAt          time.Time `firestore:"updatedAt" json:"updatedAt"`
	UpdatedBy          string    `firestore:"updatedBy" json:"updatedBy"`
}

// DefaultSettings returns sensible defaults
func DefaultSettings() RetentionSettings {
	return RetentionSettings{
		ThresholdDays:      10,
		CriticalMultiplier: 2.0,
		WatchRatio:         0.7,
		EmailEnabled:       false,
	}
}

// MemberAlert represents a single at-risk member
type MemberAlert struct {
	MemberUID               string    `json:"memberUid"`
	DisplayName             string    `json:"displayName"`
	Email                   string    `json:"email,omitempty"`
	BeltRank                string    `json:"beltRank"`
	Stripes                 int       `json:"stripes"`
	IsKids                  bool      `json:"isKids"`
	LastAttendedDate        string    `json:"lastAttendedDate"`        // "YYYY-MM-DD" or ""
	LastAttendedSessionTitle string   `json:"lastAttendedSessionTitle,omitempty"`
	DaysSinceLastAttendance int       `json:"daysSinceLastAttendance"` // -1 = never
	TotalSessions           int       `json:"totalSessions"`
	RiskLevel               RiskLevel `json:"riskLevel"`
}

// AlertsSummary is the response for the alerts endpoint
type AlertsSummary struct {
	DojoID    string        `json:"dojoId"`
	Settings  RetentionSettings `json:"settings"`
	Alerts    []MemberAlert `json:"alerts"`
	Stats     AlertStats    `json:"stats"`
	ScannedAt time.Time     `json:"scannedAt"`
}

// AlertStats holds aggregate counts
type AlertStats struct {
	TotalMembers int `json:"totalMembers"`
	TotalAtRisk  int `json:"totalAtRisk"`
	Critical     int `json:"critical"`
	Warning      int `json:"warning"`
	Watch        int `json:"watch"`
}

// UpdateSettingsInput is the request body for updating settings
type UpdateSettingsInput struct {
	ThresholdDays      *int  `json:"thresholdDays,omitempty"`
	CriticalMultiplier *float64 `json:"criticalMultiplier,omitempty"`
	WatchRatio         *float64 `json:"watchRatio,omitempty"`
	EmailEnabled       *bool `json:"emailEnabled,omitempty"`
}