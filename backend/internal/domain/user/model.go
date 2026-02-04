package user

import "time"

type Profile struct {
	UID         string    `firestore:"uid" json:"uid"`
	Email       string    `firestore:"email,omitempty" json:"email,omitempty"`
	DisplayName string    `firestore:"displayName,omitempty" json:"displayName,omitempty"`

	// role/roles はフロントで setDoc してる想定（例: roleUi, accountType など）
	Role        string    `firestore:"role,omitempty" json:"role,omitempty"`
	RoleUi      string    `firestore:"roleUi,omitempty" json:"roleUi,omitempty"`
	AccountType string    `firestore:"accountType,omitempty" json:"accountType,omitempty"`
	Roles       []string  `firestore:"roles,omitempty" json:"roles,omitempty"`

	CreatedAt time.Time `firestore:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt time.Time `firestore:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

func (p Profile) HasRole(r string) bool {
	if p.Role == r || p.RoleUi == r || p.AccountType == r {
		return true
	}
	for _, x := range p.Roles {
		if x == r {
			return true
		}
	}
	return false
}
