package session

import (
	"strings"
	"time"
)

// Session represents a class/training session in a dojo
// This is stored in the timetableClasses subcollection
type Session struct {
	ID          string    `firestore:"id" json:"id"`
	DojoID      string    `firestore:"dojoId" json:"dojoId"`
	Title       string    `firestore:"title" json:"title"`
	Description string    `firestore:"description,omitempty" json:"description,omitempty"`
	DayOfWeek   int       `firestore:"dayOfWeek" json:"dayOfWeek"` // 0=Sunday, 1=Monday, etc.
	StartTime   string    `firestore:"startTime" json:"startTime"` // "HH:MM" format
	EndTime     string    `firestore:"endTime" json:"endTime"`     // "HH:MM" format
	Instructor  string    `firestore:"instructor,omitempty" json:"instructor,omitempty"`
	ClassType   string    `firestore:"classType,omitempty" json:"classType,omitempty"` // "adult", "kids", "mixed"
	MaxCapacity int       `firestore:"maxCapacity,omitempty" json:"maxCapacity,omitempty"`
	Location    string    `firestore:"location,omitempty" json:"location,omitempty"`
	IsActive    bool      `firestore:"isActive" json:"isActive"`
	CreatedBy   string    `firestore:"createdBy" json:"createdBy"`
	CreatedAt   time.Time `firestore:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time `firestore:"updatedAt" json:"updatedAt"`

	// Frontend compatibility fields (stored in Firestore for direct reads)
	Weekday        int `firestore:"weekday" json:"weekday"`               // Same as DayOfWeek
	StartMinute    int `firestore:"startMinute" json:"startMinute"`       // Minutes from midnight
	DurationMinute int `firestore:"durationMinute" json:"durationMinute"` // Duration in minutes

	// Recurrence fields
	IsRecurring     bool      `firestore:"isRecurring" json:"isRecurring"`
	RecurrenceRule  string    `firestore:"recurrenceRule,omitempty" json:"recurrenceRule,omitempty"` // weekly, biweekly, monthly
	RecurrenceEnd   time.Time `firestore:"recurrenceEnd,omitempty" json:"recurrenceEnd,omitempty"`
	ExcludedDates   []string  `firestore:"excludedDates,omitempty" json:"excludedDates,omitempty"` // dates to skip
	ParentSessionID string    `firestore:"parentSessionId,omitempty" json:"parentSessionId,omitempty"`
}

// CreateSessionInput represents input for creating a session
type CreateSessionInput struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	DayOfWeek   int    `json:"dayOfWeek"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
	Instructor  string `json:"instructor,omitempty"`
	ClassType   string `json:"classType,omitempty"` // "adult", "kids", "mixed"
	MaxCapacity int    `json:"maxCapacity,omitempty"`
	Location    string `json:"location,omitempty"`

	// Recurrence
	IsRecurring    bool   `json:"isRecurring,omitempty"`
	RecurrenceRule string `json:"recurrenceRule,omitempty"`
	RecurrenceEnd  string `json:"recurrenceEnd,omitempty"` // ISO date string
}

// ValidClassTypes are the valid class types
var ValidClassTypes = []string{"adult", "kids", "mixed"}

func IsValidClassType(ct string) bool {
	if ct == "" {
		return true // empty is valid, defaults to "adult"
	}
	for _, v := range ValidClassTypes {
		if v == ct {
			return true
		}
	}
	return false
}

func (in *CreateSessionInput) Trim() {
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.StartTime = strings.TrimSpace(in.StartTime)
	in.EndTime = strings.TrimSpace(in.EndTime)
	in.Instructor = strings.TrimSpace(in.Instructor)
	in.ClassType = strings.TrimSpace(in.ClassType)
	in.Location = strings.TrimSpace(in.Location)
	in.RecurrenceRule = strings.TrimSpace(in.RecurrenceRule)
	in.RecurrenceEnd = strings.TrimSpace(in.RecurrenceEnd)
}

// UpdateSessionInput represents input for updating a session
type UpdateSessionInput struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	DayOfWeek   *int    `json:"dayOfWeek,omitempty"`
	StartTime   *string `json:"startTime,omitempty"`
	EndTime     *string `json:"endTime,omitempty"`
	Instructor  *string `json:"instructor,omitempty"`
	ClassType   *string `json:"classType,omitempty"` // "adult", "kids", "mixed"
	MaxCapacity *int    `json:"maxCapacity,omitempty"`
	Location    *string `json:"location,omitempty"`
	IsActive    *bool   `json:"isActive,omitempty"`

	// Recurrence
	IsRecurring    *bool   `json:"isRecurring,omitempty"`
	RecurrenceRule *string `json:"recurrenceRule,omitempty"`
	RecurrenceEnd  *string `json:"recurrenceEnd,omitempty"`
}

func (in *UpdateSessionInput) Trim() {
	if in.Title != nil {
		*in.Title = strings.TrimSpace(*in.Title)
	}
	if in.Description != nil {
		*in.Description = strings.TrimSpace(*in.Description)
	}
	if in.StartTime != nil {
		*in.StartTime = strings.TrimSpace(*in.StartTime)
	}
	if in.EndTime != nil {
		*in.EndTime = strings.TrimSpace(*in.EndTime)
	}
	if in.Instructor != nil {
		*in.Instructor = strings.TrimSpace(*in.Instructor)
	}
	if in.ClassType != nil {
		*in.ClassType = strings.TrimSpace(*in.ClassType)
	}
	if in.Location != nil {
		*in.Location = strings.TrimSpace(*in.Location)
	}
}

// ListSessionsInput represents input for listing sessions
type ListSessionsInput struct {
	DayOfWeek  *int  `json:"dayOfWeek,omitempty"`
	ActiveOnly bool  `json:"activeOnly,omitempty"`
	Limit      int64 `json:"limit,omitempty"`
}