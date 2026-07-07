package tuition

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/account"
	"github.com/stripe/stripe-go/v76/coupon"
	"github.com/stripe/stripe-go/v76/promotioncode"
	"google.golang.org/api/iterator"
)

// ============================================
// Tuition Promo Codes
// ============================================
//
// These are per-dojo discount codes for member tuition. Each one is a fixed
// amount-off coupon with duration "forever" (it keeps applying every billing
// cycle, which is what an ongoing monthly discount needs), created on the
// dojo's CONNECTED Stripe account. We expose a customer-facing Promotion Code
// (the string the member types at checkout). Redemptions are capped (default 1)
// so a code given to one member cannot quietly spread to others.
//
// Multi-tenant safety: codes live under dojos/{dojoId}/tuitionPromoCodes and
// the Stripe objects live on that dojo's connected account. One dojo can never
// see or use another dojo's codes, and code strings only need to be unique
// within a single dojo's Stripe account.

// CreateTuitionPromo creates a forever amount-off coupon + promotion code on
// the dojo's connected account. Owner only.
func (s *Service) CreateTuitionPromo(ctx context.Context, userUID string, in CreateTuitionPromoInput) (*TuitionPromoCode, error) {
	in.Trim()
	if in.DojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}
	if in.AmountOff <= 0 {
		return nil, fmt.Errorf("%w: amountOff must be positive", ErrBadRequest)
	}
	// Owner only — creating discounts affects the dojo's own revenue.
	if err := s.requireRole(ctx, in.DojoID, userUID, "owner"); err != nil {
		return nil, err
	}

	acctID, dojoData, err := s.connectAccountID(ctx, in.DojoID)
	if err != nil {
		return nil, err
	}
	if status, _ := dojoData["stripeAccountStatus"].(string); status != "active" {
		// Double-check live state — the account.updated webhook may not have
		// synced Firestore yet right after onboarding completes.
		acct, aerr := account.GetByID(acctID, nil)
		if aerr != nil || !acct.ChargesEnabled {
			return nil, fmt.Errorf("%w: this dojo has not finished payment setup", ErrNotReady)
		}
	}

	// Currency must match the dojo's tuition plans. Creating a coupon before
	// any plan exists would lock in a possibly-wrong currency (a CAD coupon
	// can never apply to a JPY plan), so we require a plan first.
	currency, ok := s.dojoPlanCurrency(ctx, in.DojoID)
	if !ok {
		return nil, fmt.Errorf("%w: create a tuition plan first — the discount currency follows your plans", ErrBadRequest)
	}

	maxRedemptions := in.MaxRedemptions
	if maxRedemptions <= 0 {
		maxRedemptions = 1
	}

	// 1) Coupon: fixed amount off, forever.
	couponParams := &stripe.CouponParams{
		AmountOff: stripe.Int64(in.AmountOff),
		Currency:  stripe.String(currency),
		Duration:  stripe.String(string(stripe.CouponDurationForever)),
	}
	if in.Note != "" {
		couponParams.Name = stripe.String(in.Note)
	}
	couponParams.SetStripeAccount(acctID)
	cpn, err := coupon.New(couponParams)
	if err != nil {
		return nil, fmt.Errorf("failed to create coupon: %w", err)
	}

	// 2) Promotion code: the string the member types at checkout.
	promoParams := &stripe.PromotionCodeParams{
		Coupon:         stripe.String(cpn.ID),
		MaxRedemptions: stripe.Int64(maxRedemptions),
	}
	if in.Code != "" {
		promoParams.Code = stripe.String(in.Code)
	}
	promoParams.SetStripeAccount(acctID)
	pc, err := promotioncode.New(promoParams)
	if err != nil {
		// Roll back the orphan coupon so we don't leave junk on the account.
		delParams := &stripe.CouponParams{}
		delParams.SetStripeAccount(acctID)
		if _, derr := coupon.Del(cpn.ID, delParams); derr != nil {
			log.Printf("tuition promo: failed to clean up coupon %s after promo error: %v", cpn.ID, derr)
		}
		return nil, fmt.Errorf("failed to create promotion code: %w", err)
	}

	rec := &TuitionPromoCode{
		Code:           pc.Code,
		StripeCouponID: cpn.ID,
		StripePromoID:  pc.ID,
		AmountOff:      in.AmountOff,
		Currency:       currency,
		MaxRedemptions: maxRedemptions,
		TimesRedeemed:  0,
		Note:           in.Note,
		Active:         true,
		CreatedAt:      time.Now().UTC(),
	}

	ref, _, err := s.fs.Collection("dojos").Doc(in.DojoID).Collection("tuitionPromoCodes").Add(ctx, map[string]interface{}{
		"code":           rec.Code,
		"stripeCouponId": rec.StripeCouponID,
		"stripePromoId":  rec.StripePromoID,
		"amountOff":      rec.AmountOff,
		"currency":       rec.Currency,
		"maxRedemptions": rec.MaxRedemptions,
		"timesRedeemed":  rec.TimesRedeemed,
		"note":           rec.Note,
		"active":         rec.Active,
		"createdAt":      rec.CreatedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to save promo code: %w", err)
	}
	rec.ID = ref.ID
	return rec, nil
}

// ListTuitionPromos returns the dojo's promo codes. Owner/staff only.
func (s *Service) ListTuitionPromos(ctx context.Context, userUID, dojoID string) ([]*TuitionPromoCode, error) {
	if err := s.requireRole(ctx, dojoID, userUID, "owner", "staff"); err != nil {
		return nil, err
	}

	acctID, _, _ := s.connectAccountID(ctx, dojoID)

	out := []*TuitionPromoCode{}
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPromoCodes").Documents(ctx)
	defer iter.Stop()
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list promo codes: %w", err)
		}
		d := doc.Data()
		rec := &TuitionPromoCode{
			ID:             doc.Ref.ID,
			Code:           asString(d["code"]),
			StripeCouponID: asString(d["stripeCouponId"]),
			StripePromoID:  asString(d["stripePromoId"]),
			AmountOff:      asInt64(d["amountOff"]),
			Currency:       asString(d["currency"]),
			MaxRedemptions: asInt64(d["maxRedemptions"]),
			TimesRedeemed:  asInt64(d["timesRedeemed"]),
			Note:           asString(d["note"]),
			Active:         asBool(d["active"]),
			CreatedAt:      asTime(d["createdAt"]),
		}
		// Best-effort: refresh live redemption count from Stripe so the owner
		// sees whether a one-time code has been used. Failure is non-fatal.
		if acctID != "" && rec.StripePromoID != "" {
			gp := &stripe.PromotionCodeParams{}
			gp.SetStripeAccount(acctID)
			if live, err := promotioncode.Get(rec.StripePromoID, gp); err == nil {
				rec.TimesRedeemed = live.TimesRedeemed
				rec.Active = live.Active
			}
		}
		out = append(out, rec)
	}
	return out, nil
}

// DeactivateTuitionPromo disables a promo code (owner only). The Stripe
// promotion code is set inactive so it can no longer be redeemed; the Firestore
// record is marked inactive too. Existing subscriptions that already applied
// the coupon keep their discount (Stripe behavior) — disabling only stops NEW
// redemptions, which matches the "give it to one member" intent.
func (s *Service) DeactivateTuitionPromo(ctx context.Context, userUID, dojoID, promoDocID string) error {
	if err := s.requireRole(ctx, dojoID, userUID, "owner"); err != nil {
		return err
	}

	docRef := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPromoCodes").Doc(promoDocID)
	snap, err := docRef.Get(ctx)
	if err != nil || !snap.Exists() {
		return fmt.Errorf("%w: promo code not found", ErrNotFound)
	}
	d := snap.Data()
	stripePromoID := asString(d["stripePromoId"])

	acctID, _, err := s.connectAccountID(ctx, dojoID)
	if err == nil && acctID != "" && stripePromoID != "" {
		params := &stripe.PromotionCodeParams{Active: stripe.Bool(false)}
		params.SetStripeAccount(acctID)
		if _, err := promotioncode.Update(stripePromoID, params); err != nil {
			log.Printf("tuition promo: failed to deactivate stripe promo %s: %v", stripePromoID, err)
		}
	}

	_, err = docRef.Set(ctx, map[string]interface{}{
		"active": false,
	}, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("failed to deactivate promo code: %w", err)
	}
	return nil
}

// dojoPlanCurrency returns the currency used by the dojo's tuition plans.
// Active plans take priority; an inactive plan's currency is used as a
// fallback. Returns ok=false when the dojo has no plans at all, so callers
// can refuse to create a coupon whose currency might not match future plans.
func (s *Service) dojoPlanCurrency(ctx context.Context, dojoID string) (string, bool) {
	fallback := ""
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPlans").Documents(ctx)
	defer iter.Stop()
	for {
		doc, err := iter.Next()
		if err != nil {
			break
		}
		d := doc.Data()
		cur := asString(d["currency"])
		if cur == "" {
			continue
		}
		if active := asBool(d["isActive"]); active {
			return strings.ToLower(cur), true
		}
		if fallback == "" {
			fallback = strings.ToLower(cur)
		}
	}
	if fallback != "" {
		return fallback, true
	}
	return "", false
}

// ---- small Firestore value helpers ----

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asInt64(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func asBool(v interface{}) bool {
	b, _ := v.(bool)
	return b
}

func asTime(v interface{}) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	return time.Time{}
}