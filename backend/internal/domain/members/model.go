package members

import (
	"strings"
	"time"
)

// Member represents a member of a dojo
type Member struct {
	UID             string    `firestore:"uid" json:"uid"`
	Status          string    `firestore:"status" json:"status"`
	RoleInDojo      string    `firestore:"roleInDojo" json:"roleInDojo"`
	BeltRank        string    `firestore:"beltRank,omitempty" json:"beltRank,omitempty"`
	Stripes         int       `firestore:"stripes,omitempty" json:"stripes,omitempty"`
	JoinedAt        time.Time `firestore:"joinedAt" json:"joinedAt"`
	ApprovedBy      string    `firestore:"approvedBy,omitempty" json:"approvedBy,omitempty"`
	ApprovedAt      time.Time `firestore:"approvedAt,omitempty" json:"approvedAt,omitempty"`
	CreatedAt       time.Time `firestore:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time `firestore:"updatedAt" json:"updatedAt"`
	LastPromotionAt time.Time `firestore:"lastPromotionAt,omitempty" json:"lastPromotionAt,omitempty"`
	LastPromotedBy  string    `firestore:"lastPromotedBy,omitempty" json:"lastPromotedBy,omitempty"`
}

// MemberUser represents user info associated with a member
type MemberUser struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	PhotoURL    string `json:"photoURL"`
}

// MemberWithUser represents a member with associated user info
type MemberWithUser struct {
	UID    string     `json:"uid"`
	Member Member     `json:"member"`
	User   MemberUser `json:"user"`
}

const (
	RoleStudent = "student"
	RoleCoach   = "coach"
	RoleStaff   = "staff"
	RoleOwner   = "owner"

	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusActive   = "active"
	StatusInactive = "inactive"
)

// AddMemberInput represents input for adding a member to a dojo
type AddMemberInput struct {
	DojoID    string `json:"dojoId"`
	MemberUID string `json:"memberUid"`

	// Optional fields (empty string means "use default" in service)
	RoleInDojo string `json:"roleInDojo,omitempty"` // "student", "coach", "staff", "owner"
	Status     string `json:"status,omitempty"`     // "pending", "approved", "active", "inactive"

	BeltRank string `json:"beltRank,omitempty"`
	Stripes  int    `json:"stripes,omitempty"`
}

func (in *AddMemberInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.MemberUID = strings.TrimSpace(in.MemberUID)

	// 既存互換を壊さない範囲で正規化（小文字化して判定しやすく）
	in.RoleInDojo = strings.ToLower(strings.TrimSpace(in.RoleInDojo))
	in.Status = strings.ToLower(strings.TrimSpace(in.Status))

	in.BeltRank = strings.TrimSpace(in.BeltRank)
}

// UpdateMemberInput represents input for updating a member
type UpdateMemberInput struct {
	DojoID     string  `json:"dojoId"`
	MemberUID  string  `json:"memberUid"`
	RoleInDojo *string `json:"roleInDojo,omitempty"`
	Status     *string `json:"status,omitempty"`
	BeltRank   *string `json:"beltRank,omitempty"`
	Stripes    *int    `json:"stripes,omitempty"`
}

func (in *UpdateMemberInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.MemberUID = strings.TrimSpace(in.MemberUID)

	if in.RoleInDojo != nil {
		v := strings.ToLower(strings.TrimSpace(*in.RoleInDojo))
		*in.RoleInDojo = v
	}
	if in.Status != nil {
		v := strings.ToLower(strings.TrimSpace(*in.Status))
		*in.Status = v
	}
	if in.BeltRank != nil {
		v := strings.TrimSpace(*in.BeltRank)
		*in.BeltRank = v
	}
}

// ListMembersInput represents input for listing members
type ListMembersInput struct {
	DojoID string `json:"dojoId"`
	Status string `json:"status,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

var ValidRoles = []string{RoleStudent, RoleCoach, RoleStaff, RoleOwner}
var ValidStatuses = []string{StatusPending, StatusApproved, StatusActive, StatusInactive}

func IsValidRole(role string) bool {
	for _, r := range ValidRoles {
		if r == role {
			return true
		}
	}
	return false
}

func IsValidStatus(status string) bool {
	for _, s := range ValidStatuses {
		if s == status {
			return true
		}
	}
	return false
}
