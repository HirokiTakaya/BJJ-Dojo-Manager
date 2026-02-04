package ranks

import (
	"strings"
	"time"
)

// Belt order for adults (BJJ standard)
var BeltOrder = []string{
	"white",
	"blue",
	"purple",
	"brown",
	"black",
	"red_black", // coral belt
	"red",
}

// Belt order for kids
var KidsBeltOrder = []string{
	"white",
	"grey_white",
	"grey",
	"grey_black",
	"yellow_white",
	"yellow",
	"yellow_black",
	"orange_white",
	"orange",
	"orange_black",
	"green_white",
	"green",
	"green_black",
}

// RankHistory represents a promotion history record
type RankHistory struct {
	ID              string    `firestore:"id" json:"id"`
	PreviousBelt    string    `firestore:"previousBelt" json:"previousBelt"`
	PreviousStripes int       `firestore:"previousStripes" json:"previousStripes"`
	NewBelt         string    `firestore:"newBelt" json:"newBelt"`
	NewStripes      int       `firestore:"newStripes" json:"newStripes"`
	PromotedBy      string    `firestore:"promotedBy" json:"promotedBy"`
	Notes           string    `firestore:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt       time.Time `firestore:"createdAt" json:"createdAt"`
}

// UpdateMemberRankInput represents input for updating a member's rank
type UpdateMemberRankInput struct {
	DojoID    string `json:"dojoId"`
	MemberUID string `json:"memberUid"`
	BeltRank  string `json:"beltRank"`
	Stripes   *int   `json:"stripes,omitempty"`
	Notes     string `json:"notes,omitempty"`
}

func (in *UpdateMemberRankInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.MemberUID = strings.TrimSpace(in.MemberUID)
	in.BeltRank = strings.TrimSpace(in.BeltRank)
	in.Notes = strings.TrimSpace(in.Notes)
}

// AddStripeInput represents input for adding a stripe
type AddStripeInput struct {
	DojoID    string `json:"dojoId"`
	MemberUID string `json:"memberUid"`
	Notes     string `json:"notes,omitempty"`
}

func (in *AddStripeInput) Trim() {
	in.DojoID = strings.TrimSpace(in.DojoID)
	in.MemberUID = strings.TrimSpace(in.MemberUID)
	in.Notes = strings.TrimSpace(in.Notes)
}

// BeltDistribution represents belt distribution statistics
type BeltDistribution struct {
	Belt    string         `json:"belt"`
	Count   int            `json:"count"`
	Stripes map[int]int    `json:"stripes"`
}

// BeltDistributionResult represents the result of belt distribution query
type BeltDistributionResult struct {
	Total        int                `json:"total"`
	Distribution []BeltDistribution `json:"distribution"`
}
