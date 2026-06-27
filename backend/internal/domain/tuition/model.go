package tuition

import (
	"strings"
	"time"
)

// ============================================
// Connect Account
// ============================================

// ConnectStatus represents the dojo's Stripe Connect account state.
type ConnectStatus struct {
	AccountID        string `json:"accountId,omitempty"`
	DetailsSubmitted bool   `json:"detailsSubmitted"`
	ChargesEnabled   bool   `json:"chargesEnabled"`
	PayoutsEnabled   bool   `json:"payoutsEnabled"`
	// "none" | "pending" | "active"
	Status string `json:"status"`
}

// CreateOnboardingInput is the input for starting Connect onboarding.
type CreateOnboardingInput struct {
	DojoID     string `json:"dojoId"`
	Country    string `json:"country"` // ISO 3166-1 alpha-2, e.g. "CA", "JP". Default "CA".
	RefreshURL string `json:"refreshUrl"`
	ReturnURL  string `json:"returnUrl"`
}

func (i *CreateOnboardingInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.Country = strings.ToUpper(strings.TrimSpace(i.Country))
	i.RefreshURL = strings.TrimSpace(i.RefreshURL)
	i.ReturnURL = strings.TrimSpace(i.ReturnURL)
}

// ============================================
// Tuition Plans
// ============================================

// TuitionPlan is a monthly-fee plan owned by a dojo (lives on the dojo's
// connected Stripe account).
//
// Amount is in the smallest currency unit, following Stripe convention:
//   - cad/usd: cents (12000 = $120.00)
//   - jpy: yen (12000 = ¥12,000, zero-decimal currency)
type TuitionPlan struct {
	ID              string    `firestore:"-" json:"id"`
	Name            string    `firestore:"name" json:"name"`
	Description     string    `firestore:"description,omitempty" json:"description,omitempty"`
	Amount          int64     `firestore:"amount" json:"amount"`
	Currency        string    `firestore:"currency" json:"currency"` // "cad" | "jpy" | ...
	Interval        string    `firestore:"interval" json:"interval"` // "month" | "year" | "week"
	StripeProductID string    `firestore:"stripeProductId" json:"stripeProductId"`
	StripePriceID   string    `firestore:"stripePriceId" json:"stripePriceId"`
	IsActive        bool      `firestore:"isActive" json:"isActive"`
	CreatedAt       time.Time `firestore:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time `firestore:"updatedAt" json:"updatedAt"`
}

// CreateTuitionPlanInput is the input for creating a tuition plan.
type CreateTuitionPlanInput struct {
	DojoID      string `json:"dojoId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	Interval    string `json:"interval"`
}

func (i *CreateTuitionPlanInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.Name = strings.TrimSpace(i.Name)
	i.Description = strings.TrimSpace(i.Description)
	i.Currency = strings.ToLower(strings.TrimSpace(i.Currency))
	i.Interval = strings.ToLower(strings.TrimSpace(i.Interval))
}

// ============================================
// Member tuition subscription
// ============================================

// MemberTuition is the tuition-related slice of a member document.
type MemberTuition struct {
	UID            string `json:"uid"`
	DisplayName    string `json:"displayName,omitempty"`
	Email          string `json:"email,omitempty"`
	CustomerID     string `json:"customerId,omitempty"`
	SubscriptionID string `json:"subscriptionId,omitempty"`
	// "none" | "active" | "past_due" | "canceled" | "incomplete"
	Status            string     `json:"status"`
	PlanID            string     `json:"planId,omitempty"`
	PeriodEnd         *time.Time `json:"periodEnd,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancelAtPeriodEnd"`
}

// CreateTuitionCheckoutInput is the input for a member starting a tuition
// subscription via Stripe Checkout.
type CreateTuitionCheckoutInput struct {
	DojoID     string `json:"dojoId"`
	PlanID     string `json:"planId"`
	SuccessURL string `json:"successUrl"`
	CancelURL  string `json:"cancelUrl"`
}

func (i *CreateTuitionCheckoutInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.PlanID = strings.TrimSpace(i.PlanID)
	i.SuccessURL = strings.TrimSpace(i.SuccessURL)
	i.CancelURL = strings.TrimSpace(i.CancelURL)
}

// CreateTuitionPortalInput is the input for opening the member-facing
// billing portal (card update / cancel) on the dojo's connected account.
type CreateTuitionPortalInput struct {
	DojoID    string `json:"dojoId"`
	ReturnURL string `json:"returnUrl"`
}

func (i *CreateTuitionPortalInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.ReturnURL = strings.TrimSpace(i.ReturnURL)
}

// TuitionPayment is a payment record stored under
// dojos/{dojoId}/tuitionPayments/{invoiceId}.
type TuitionPayment struct {
	ID             string    `firestore:"-" json:"id"`
	MemberUID      string    `firestore:"memberUid" json:"memberUid"`
	SubscriptionID string    `firestore:"subscriptionId" json:"subscriptionId"`
	Amount         int64     `firestore:"amount" json:"amount"`
	Currency       string    `firestore:"currency" json:"currency"`
	Status         string    `firestore:"status" json:"status"` // "paid" | "failed"
	InvoiceURL     string    `firestore:"invoiceUrl,omitempty" json:"invoiceUrl,omitempty"`
	InvoicePDF     string    `firestore:"invoicePdf,omitempty" json:"invoicePdf,omitempty"`
	CreatedAt      time.Time `firestore:"createdAt" json:"createdAt"`
}

// ============================================
// Tuition Promo Codes (per-dojo discount codes)
// ============================================
//
// Stored under dojos/{dojoId}/tuitionPromoCodes/{codeId}. Each promo code is
// scoped to a single dojo and backed by a Stripe Coupon + Promotion Code that
// live on that dojo's CONNECTED account. A code is a fixed amount-off,
// duration "forever" (so it keeps applying every billing cycle), and limited
// to a small number of redemptions so it cannot spread to other members.

type TuitionPromoCode struct {
	ID             string    `firestore:"-" json:"id"`
	Code           string    `firestore:"code" json:"code"`
	StripeCouponID string    `firestore:"stripeCouponId" json:"stripeCouponId"`
	StripePromoID  string    `firestore:"stripePromoId" json:"stripePromoId"`
	AmountOff      int64     `firestore:"amountOff" json:"amountOff"` // smallest currency unit
	Currency       string    `firestore:"currency" json:"currency"`
	MaxRedemptions int64     `firestore:"maxRedemptions" json:"maxRedemptions"`
	TimesRedeemed  int64     `firestore:"timesRedeemed" json:"timesRedeemed"`
	Note           string    `firestore:"note,omitempty" json:"note,omitempty"` // e.g. "Tanaka — weekly"
	Active         bool      `firestore:"active" json:"active"`
	CreatedAt      time.Time `firestore:"createdAt" json:"createdAt"`
}

// CreateTuitionPromoInput — owner creates a fixed amount-off, forever code.
type CreateTuitionPromoInput struct {
	DojoID         string `json:"dojoId"`
	Code           string `json:"code"`           // optional; Stripe auto-generates if empty
	AmountOff      int64  `json:"amountOff"`      // smallest currency unit, e.g. 3500 = $35.00
	MaxRedemptions int64  `json:"maxRedemptions"` // optional; defaults to 1
	Note           string `json:"note"`           // optional label, owner-only
}

func (i *CreateTuitionPromoInput) Trim() {
	i.DojoID = strings.TrimSpace(i.DojoID)
	i.Code = strings.ToUpper(strings.TrimSpace(i.Code))
	i.Note = strings.TrimSpace(i.Note)
}