package attendance

import (
	"strings"
	"time"
)

// AttendanceStatus represents the status of an attendance record
type AttendanceStatus string

const (
	StatusPresent AttendanceStatus = "present"
	StatusAbsent  AttendanceStatus = "absent"
	StatusLate    AttendanceStatus = "late"
	StatusExcused AttendanceStatus = "excused"
)

var ValidStatuses = []AttendanceStatus{StatusPresent, StatusAbsent, StatusLate, StatusExcused}

func IsValidStatus(s string) bool {
	for _, v := range ValidStatuses {
		if string(v) == s {
			return true
		}
	}
	return false
}

// Attendance represents an attendance record
type Attendance struct {
	ID                string           `firestore:"id" json:"id"`
	DojoID            string           `firestore:"dojoId" json:"dojoId"`
	SessionInstanceID string           `firestore:"sessionInstanceId" json:"sessionInstanceId"`
	MemberUID         string           `firestore:"memberUid" json:"memberUid"`
	Status            AttendanceStatus `firestore:"status" json:"status"`
	CheckInTime       *time.Time       `firestore:"checkInTime,omitempty" json:"checkInTime,omitempty"`
	CheckOutTime      *time.Time       `firestore:"checkOutTime,omitempty" json:"checkOutTime,omitempty"`
	Notes             string           `firestore:"notes,omitempty" json:"notes,omitempty"`
	RecordedBy        string           `firestore:"recordedBy" json:"recordedBy"`
	CreatedAt         time.Time        `firestore:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time        `firestore:"updatedAt" json:"updatedAt"`
}

// RecordAttendanceInput represents input for recording attendance
type RecordAttendanceInput struct {
	DojoID            string `json:"dojoId"`
	SessionInstanceID string `json:"sessionInstanceId"`
	MemberUID         string `json:"memberUid"`
	Status            string `json:"status"`
	Notes             string `json:"notes,omitempty"`
}

func (in *RecordAttendanceInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.SessionInstanceID = strings.TrimSpace(in.SessionInstanceID)
	in.MemberUID = strings.TrimSpace(in.MemberUID)
	in.Status = strings.TrimSpace(in.Status)
	if len(in.Notes) > 500 {
		in.Notes = in.Notes[:500]
	}
}

// UpdateAttendanceInput represents input for updating attendance
type UpdateAttendanceInput struct {
	DojoID string  `json:"dojoId"`
	ID     string  `json:"id"`
	Status *string `json:"status,omitempty"`
	Notes  *string `json:"notes,omitempty"`
}

func (in *UpdateAttendanceInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.ID = strings.TrimSpace(in.ID)
	if in.Notes != nil && len(*in.Notes) > 500 {
		s := (*in.Notes)[:500]
		in.Notes = &s
	}
}

// BulkAttendanceRecord represents a single record in a bulk attendance request
type BulkAttendanceRecord struct {
	MemberUID string `json:"memberUid"`
	Status    string `json:"status"`
	Notes     string `json:"notes,omitempty"`
}

// BulkAttendanceInput represents input for bulk attendance recording
type BulkAttendanceInput struct {
	DojoID            string                 `json:"dojoId"`
	SessionInstanceID string                 `json:"sessionInstanceId"`
	Records           []BulkAttendanceRecord `json:"records"`
}

// ListAttendanceInput represents input for listing attendance
type ListAttendanceInput struct {
	DojoID            string `json:"dojoId"`
	SessionInstanceID string `json:"sessionInstanceId,omitempty"`
	MemberUID         string `json:"memberUid,omitempty"`
	Limit             int    `json:"limit,omitempty"`
}
