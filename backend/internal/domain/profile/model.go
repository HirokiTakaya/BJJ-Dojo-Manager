package profile

import (
	"strings"
	"time"
)

// UserProfile represents a user profile
type UserProfile struct {
	UID              string                 `firestore:"uid" json:"uid"`
	Email            string                 `firestore:"email" json:"email"`
	DisplayName      string                 `firestore:"displayName" json:"displayName"`
	PhotoURL         string                 `firestore:"photoURL,omitempty" json:"photoURL,omitempty"`
	Role             string                 `firestore:"role,omitempty" json:"role,omitempty"`
	Roles            []string               `firestore:"roles,omitempty" json:"roles,omitempty"`
	Language         string                 `firestore:"language,omitempty" json:"language,omitempty"`
	IsActive         bool                   `firestore:"isActive" json:"isActive"`
	EmergencyContact map[string]interface{} `firestore:"emergencyContact,omitempty" json:"emergencyContact,omitempty"`
	CreatedAt        time.Time              `firestore:"createdAt" json:"createdAt"`
	UpdatedAt        time.Time              `firestore:"updatedAt" json:"updatedAt"`
}

// UpdateProfileInput represents input for updating a profile
type UpdateProfileInput struct {
	DisplayName      *string                `json:"displayName,omitempty"`
	PhotoURL         *string                `json:"photoURL,omitempty"`
	Language         *string                `json:"language,omitempty"`
	EmergencyContact map[string]interface{} `json:"emergencyContact,omitempty"`
}

func (in *UpdateProfileInput) Trim() {
	if in.DisplayName != nil {
		*in.DisplayName = strings.TrimSpace(*in.DisplayName)
	}
	if in.PhotoURL != nil {
		*in.PhotoURL = strings.TrimSpace(*in.PhotoURL)
	}
	if in.Language != nil {
		*in.Language = strings.TrimSpace(*in.Language)
	}
}

// ProtectedFields are fields that cannot be updated by the user
var ProtectedFields = []string{"uid", "email", "role", "roles", "admin", "createdAt", "createdBy"}
