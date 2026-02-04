package models

import "time"

type Dojo struct {
	ID           string    `json:"id" firestore:"-"`
	Name         string    `json:"name" firestore:"name"`
	NameLower    string    `json:"nameLower" firestore:"nameLower"`
	Slug         string    `json:"slug" firestore:"slug"`
	JoinMode     string    `json:"joinMode" firestore:"joinMode"`
	CreatedByUID string    `json:"createdByUid" firestore:"createdByUid"`
	CreatedBy    string    `json:"createdBy" firestore:"createdBy"`
	CreatedAt    time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt" firestore:"updatedAt"`
	Active       bool      `json:"active" firestore:"active"`
	City         string    `json:"city,omitempty" firestore:"city,omitempty"`
	Country      string    `json:"country,omitempty" firestore:"country,omitempty"`
	Address      string    `json:"address,omitempty" firestore:"address,omitempty"`
	SearchTokens []string  `json:"searchTokens,omitempty" firestore:"searchTokens,omitempty"`
	IsPublic     bool      `json:"isPublic" firestore:"isPublic"`
}

type Member struct {
	UID          string    `json:"uid" firestore:"uid"`
	Role         string    `json:"role" firestore:"role"`
	Status       string    `json:"status" firestore:"status"`
	JoinedAt     time.Time `json:"joinedAt" firestore:"joinedAt"`
	CreatedAt    time.Time `json:"createdAt" firestore:"createdAt"`
	CreatedByUID string    `json:"createdByUid" firestore:"createdByUid"`
	DisplayName  string    `json:"displayName,omitempty" firestore:"displayName,omitempty"`
}

// DojoMember represents a member of a dojo
type DojoMember struct {
	UID        string    `json:"uid" firestore:"uid"`
	Role       string    `json:"role" firestore:"role"`
	Status     string    `json:"status" firestore:"status"`
	JoinedAt   time.Time `json:"joinedAt" firestore:"joinedAt"`
	ApprovedBy string    `json:"approvedBy,omitempty" firestore:"approvedBy,omitempty"`
	ApprovedAt time.Time `json:"approvedAt,omitempty" firestore:"approvedAt,omitempty"`
}

type JoinRequest struct {
	UID         string    `json:"uid" firestore:"uid"`
	DojoID      string    `json:"dojoId" firestore:"dojoId"`
	Status      string    `json:"status" firestore:"status"`
	Message     string    `json:"message,omitempty" firestore:"message,omitempty"`
	CreatedAt   time.Time `json:"createdAt" firestore:"createdAt"`
	RequestedBy string    `json:"requestedByUid" firestore:"requestedByUid"`
	DisplayName string    `json:"displayName,omitempty" firestore:"displayName,omitempty"`
	Email       string    `json:"email,omitempty" firestore:"email,omitempty"`
}

type UserDojoIndex struct {
	DojoID    string    `json:"dojoId" firestore:"dojoId"`
	Role      string    `json:"role" firestore:"role"`
	Status    string    `json:"status" firestore:"status"`
	JoinedAt  time.Time `json:"joinedAt" firestore:"joinedAt"`
	DojoName  string    `json:"dojoName" firestore:"dojoName"`
	DojoSlug  string    `json:"dojoSlug" firestore:"dojoSlug"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type Booking struct {
	DojoID    string    `json:"dojoId" firestore:"dojoId"`
	UserID    string    `json:"userId" firestore:"userId"`
	ClassID   string    `json:"classId,omitempty" firestore:"classId,omitempty"`
	StartAt   time.Time `json:"startAt" firestore:"startAt"`
	EndAt     time.Time `json:"endAt" firestore:"endAt"`
	Status    string    `json:"status" firestore:"status"`
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}