package stripe

import (
	"strings"
	"time"
)

// Plan types
const (
	PlanFree     = "free"
	PlanPro      = "pro"
	PlanBusiness = "business"
)

// PlanLimits defines the limits for each plan
type PlanLimits struct {
	Members       int // -1 = unlimited
	Staff         int
	Announcements int
	Classes       int
}

// GetPlanLimits returns the limits for a given plan
func GetPlanLimits(plan string) PlanLimits {
	switch plan {
	case PlanPro:
		return PlanLimits{
			Members:       150,
			Staff:         10,
			Announcements: 20,
			Classes:       30,
		}
	case PlanBusiness:
		return PlanLimits{
			Members:       -1, // unlimited
			Staff:         -1,
			Announcements: -1,
			Classes:       -1,
		}
	default: // free
		return PlanLimits{
			Members:       20,
			Staff:         2,
			Announcements: 3,
			Classes:       5,
		}
	}
}

// ResourceUsage represents current usage and limit for a resource
type ResourceUsage struct {
	Current int `json:"current"`
	Limit   int `json:"limit"` // -1 = unlimited
}

// UsageInfo contains usage info for all resources
type UsageInfo struct {
	Members       ResourceUsage `json:"members"`
	Staff         ResourceUsage `json:"staff"`
	Announcements ResourceUsage `json:"announcements"`
	Classes       ResourceUsage `json:"classes"`
}

// SubscriptionInfo contains subscription details
type SubscriptionInfo struct {
	Plan              string     `json:"plan"`
	Status            string     `json:"status"`
	PeriodEnd         *time.Time `json:"periodEnd,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancelAtPeriodEnd"`
	Usage             UsageInfo  `json:"usage"`
}

// CreateCheckoutInput is the input for creating a checkout session
type CreateCheckoutInput struct {
	DojoID     string `json:"dojoId"`
	Plan       string `json:"plan"`       // "pro" or "business"
	Period     string `json:"period"`     // "monthly" or "yearly"
	SuccessURL string `json:"successUrl"`
	CancelURL  string `json:"cancelUrl"`
}

func (i *CreateCheckoutInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.Plan = strings.TrimSpace(i.Plan)
	i.Period = strings.TrimSpace(i.Period)
	i.SuccessURL = strings.TrimSpace(i.SuccessURL)
	i.CancelURL = strings.TrimSpace(i.CancelURL)
}

// CreatePortalInput is the input for creating a portal session
type CreatePortalInput struct {
	DojoID    string `json:"dojoId"`
	ReturnURL string `json:"returnUrl"`
}

func (i *CreatePortalInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.ReturnURL = strings.TrimSpace(i.ReturnURL)
}

// DojoSubscription represents the subscription data stored in Firestore
type DojoSubscription struct {
	Plan               string    `firestore:"plan" json:"plan"`
	SubscriptionID     string    `firestore:"subscriptionId" json:"subscriptionId"`
	SubscriptionStatus string    `firestore:"subscriptionStatus" json:"subscriptionStatus"`
	StripeCustomerID   string    `firestore:"stripeCustomerId" json:"stripeCustomerId"`
	PlanPeriodEnd      time.Time `firestore:"planPeriodEnd" json:"planPeriodEnd"`
	CancelAtPeriodEnd  bool      `firestore:"cancelAtPeriodEnd" json:"cancelAtPeriodEnd"`
}

// Payment represents a payment record
type Payment struct {
	ID             string    `firestore:"-" json:"id"`
	InvoiceID      string    `firestore:"invoiceId" json:"invoiceId"`
	SubscriptionID string    `firestore:"subscriptionId" json:"subscriptionId"`
	Amount         int64     `firestore:"amount" json:"amount"`
	Currency       string    `firestore:"currency" json:"currency"`
	Status         string    `firestore:"status" json:"status"`
	InvoiceURL     string    `firestore:"invoiceUrl,omitempty" json:"invoiceUrl,omitempty"`
	InvoicePDF     string    `firestore:"invoicePdf,omitempty" json:"invoicePdf,omitempty"`
	CreatedAt      time.Time `firestore:"createdAt" json:"createdAt"`
}

// SubscriptionEvent represents a subscription event for audit
type SubscriptionEvent struct {
	ID                string    `firestore:"-" json:"id"`
	Type              string    `firestore:"type" json:"type"`
	SubscriptionID    string    `firestore:"subscriptionId" json:"subscriptionId"`
	Status            string    `firestore:"status" json:"status"`
	Plan              string    `firestore:"plan" json:"plan"`
	PriceID           string    `firestore:"priceId,omitempty" json:"priceId,omitempty"`
	PeriodEnd         time.Time `firestore:"periodEnd,omitempty" json:"periodEnd,omitempty"`
	CancelAtPeriodEnd bool      `firestore:"cancelAtPeriodEnd" json:"cancelAtPeriodEnd"`
	CreatedAt         time.Time `firestore:"createdAt" json:"createdAt"`
}
