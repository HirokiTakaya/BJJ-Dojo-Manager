package dojo

import (
	"strings"
	"time"
)

type Dojo struct {
	ID        string    `firestore:"id" json:"id"`
	Name      string    `firestore:"name" json:"name"`
	NameLower string    `firestore:"nameLower" json:"-"`
	Slug      string    `firestore:"slug" json:"slug"`
	City      string    `firestore:"city,omitempty" json:"city,omitempty"`
	Country   string    `firestore:"country,omitempty" json:"country,omitempty"`

	CreatedBy string   `firestore:"createdBy" json:"createdBy"`
	OwnerUID  string   `firestore:"ownerUid,omitempty" json:"ownerUid,omitempty"`
	OwnerIds  []string `firestore:"ownerIds,omitempty" json:"ownerIds,omitempty"`
	StaffUids []string `firestore:"staffUids,omitempty" json:"staffUids,omitempty"`

	CreatedAt time.Time `firestore:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `firestore:"updatedAt" json:"updatedAt"`
}

type Membership struct {
	UID       string    `firestore:"uid" json:"uid"`
	Role      string    `firestore:"role" json:"role"` // student / staff
	Belt      string    `firestore:"belt,omitempty" json:"belt,omitempty"`
	FullName  string    `firestore:"fullName,omitempty" json:"fullName,omitempty"`
	JoinedAt  time.Time `firestore:"joinedAt" json:"joinedAt"`
	UpdatedAt time.Time `firestore:"updatedAt" json:"updatedAt"`
}

type JoinRequest struct {
	UID       string    `firestore:"uid" json:"uid"`
	DojoID    string    `firestore:"dojoId" json:"dojoId"`
	FullName  string    `firestore:"fullName" json:"fullName"`
	Belt      string    `firestore:"belt,omitempty" json:"belt,omitempty"`
	Status    string    `firestore:"status" json:"status"` // pending/approved/rejected
	CreatedAt time.Time `firestore:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `firestore:"updatedAt" json:"updatedAt"`
}

type CreateDojoInput struct {
	Name    string `json:"name"`
	Slug    string `json:"slug,omitempty"`
	City    string `json:"city,omitempty"`
	Country string `json:"country,omitempty"`
}

func (in *CreateDojoInput) Trim() {
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.TrimSpace(in.Slug)
	in.City = strings.TrimSpace(in.City)
	in.Country = strings.TrimSpace(in.Country)
}

type CreateJoinRequestInput struct {
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Belt      string `json:"belt,omitempty"`
}

func (in *CreateJoinRequestInput) Trim() {
	in.FirstName = strings.TrimSpace(in.FirstName)
	in.LastName = strings.TrimSpace(in.LastName)
	in.Belt = strings.TrimSpace(in.Belt)
}
