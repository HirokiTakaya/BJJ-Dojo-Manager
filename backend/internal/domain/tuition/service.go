package tuition

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/account"
	"github.com/stripe/stripe-go/v76/accountlink"
	portalconfiguration "github.com/stripe/stripe-go/v76/billingportal/configuration"
	portalsession "github.com/stripe/stripe-go/v76/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v76/checkout/session"
	"github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/price"
	"github.com/stripe/stripe-go/v76/subscription"
	"google.golang.org/api/iterator"
)

type Config struct {
	SecretKey            string
	ConnectWebhookSecret string
}

func LoadConfig() Config {
	return Config{
		SecretKey:            os.Getenv("STRIPE_SECRET_KEY"),
		ConnectWebhookSecret: os.Getenv("STRIPE_CONNECT_WEBHOOK_SECRET"),
	}
}

type Service struct {
	fs     *firestore.Client
	config Config
}

func NewService(fs *firestore.Client, cfg Config) *Service {
	// stripe.Key is already set by the existing stripe domain service, but
	// set it here too so tuition works even if that service is disabled.
	stripe.Key = cfg.SecretKey
	return &Service{fs: fs, config: cfg}
}

// ============================================
// Authorization helpers
// ============================================

// memberDoc fetches dojos/{dojoId}/members/{uid}.
func (s *Service) memberDoc(ctx context.Context, dojoID, uid string) (map[string]interface{}, error) {
	doc, err := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(uid).Get(ctx)
	if err != nil || !doc.Exists() {
		return nil, fmt.Errorf("%w: not a member of this dojo", ErrUnauthorized)
	}
	return doc.Data(), nil
}

// requireRole verifies the user has one of the given roleInDojo values.
func (s *Service) requireRole(ctx context.Context, dojoID, uid string, roles ...string) error {
	data, err := s.memberDoc(ctx, dojoID, uid)
	if err != nil {
		return err
	}
	role, _ := data["roleInDojo"].(string)
	for _, r := range roles {
		if role == r {
			return nil
		}
	}
	return fmt.Errorf("%w: requires role %v", ErrUnauthorized, roles)
}

// requireActiveMember verifies the user is an active (or approved) member.
func (s *Service) requireActiveMember(ctx context.Context, dojoID, uid string) (map[string]interface{}, error) {
	data, err := s.memberDoc(ctx, dojoID, uid)
	if err != nil {
		return nil, err
	}
	status, _ := data["status"].(string)
	if status != "active" && status != "approved" {
		return nil, fmt.Errorf("%w: membership is not active", ErrUnauthorized)
	}
	return data, nil
}

// connectAccountID returns the dojo's connected account ID, or error if the
// dojo has not completed Connect onboarding.
func (s *Service) connectAccountID(ctx context.Context, dojoID string) (string, map[string]interface{}, error) {
	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("%w: dojo not found", ErrNotFound)
	}
	data := dojoDoc.Data()
	acctID, _ := data["stripeAccountId"].(string)
	if acctID == "" {
		return "", data, fmt.Errorf("%w: dojo has not set up payments", ErrNotReady)
	}
	return acctID, data, nil
}

// ============================================
// Connect onboarding
// ============================================

// CreateOnboardingLink creates (if needed) an Express connected account for
// the dojo and returns a hosted onboarding URL. Owner only.
func (s *Service) CreateOnboardingLink(ctx context.Context, userUID string, in CreateOnboardingInput) (string, error) {
	in.Trim()
	if in.DojoID == "" {
		return "", fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}
	if in.RefreshURL == "" || in.ReturnURL == "" {
		return "", fmt.Errorf("%w: refreshUrl and returnUrl are required", ErrBadRequest)
	}
	if err := s.requireRole(ctx, in.DojoID, userUID, "owner"); err != nil {
		return "", err
	}

	dojoDoc, err := s.fs.Collection("dojos").Doc(in.DojoID).Get(ctx)
	if err != nil {
		return "", fmt.Errorf("%w: dojo not found", ErrNotFound)
	}
	dojoData := dojoDoc.Data()
	acctID, _ := dojoData["stripeAccountId"].(string)

	// Validate the stored account is usable in the current Stripe mode
	// (same lesson as the Live-mode customer migration: stored IDs from
	// test mode are invalid in live mode).
	if acctID != "" {
		if _, err := account.GetByID(acctID, nil); err != nil {
			log.Printf("tuition: stored account %s not valid in current Stripe mode, recreating: %v", acctID, err)
			acctID = ""
		}
	}

	if acctID == "" {
		country := in.Country
		if country == "" {
			country = "CA"
		}
		dojoName, _ := dojoData["name"].(string)

		params := &stripe.AccountParams{
			Type:    stripe.String(string(stripe.AccountTypeExpress)),
			Country: stripe.String(country),
			Capabilities: &stripe.AccountCapabilitiesParams{
				CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{Requested: stripe.Bool(true)},
				Transfers:    &stripe.AccountCapabilitiesTransfersParams{Requested: stripe.Bool(true)},
			},
			BusinessProfile: &stripe.AccountBusinessProfileParams{
				Name: stripe.String(dojoName),
			},
			Metadata: map[string]string{
				"dojoId": in.DojoID,
			},
		}
		acct, err := account.New(params)
		if err != nil {
			return "", fmt.Errorf("failed to create connect account: %w", err)
		}
		acctID = acct.ID

		if _, err := s.fs.Collection("dojos").Doc(in.DojoID).Set(ctx, map[string]interface{}{
			"stripeAccountId":     acctID,
			"stripeAccountStatus": "pending",
		}, firestore.MergeAll); err != nil {
			log.Printf("tuition: failed to save account id: %v", err)
		}
	}

	linkParams := &stripe.AccountLinkParams{
		Account:    stripe.String(acctID),
		RefreshURL: stripe.String(in.RefreshURL),
		ReturnURL:  stripe.String(in.ReturnURL),
		Type:       stripe.String("account_onboarding"),
	}
	link, err := accountlink.New(linkParams)
	if err != nil {
		return "", fmt.Errorf("failed to create onboarding link: %w", err)
	}
	return link.URL, nil
}

// GetConnectStatus fetches the live account state from Stripe and syncs the
// summarized status to Firestore. Owner/staff only.
func (s *Service) GetConnectStatus(ctx context.Context, userUID, dojoID string) (*ConnectStatus, error) {
	if err := s.requireRole(ctx, dojoID, userUID, "owner", "staff", "coach"); err != nil {
		return nil, err
	}

	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: dojo not found", ErrNotFound)
	}
	acctID, _ := dojoDoc.Data()["stripeAccountId"].(string)
	if acctID == "" {
		return &ConnectStatus{Status: "none"}, nil
	}

	acct, err := account.GetByID(acctID, nil)
	if err != nil {
		log.Printf("tuition: failed to fetch account %s: %v", acctID, err)
		return &ConnectStatus{AccountID: acctID, Status: "none"}, nil
	}

	status := "pending"
	if acct.ChargesEnabled {
		status = "active"
	}

	if _, err := s.fs.Collection("dojos").Doc(dojoID).Set(ctx, map[string]interface{}{
		"stripeAccountStatus": status,
	}, firestore.MergeAll); err != nil {
		log.Printf("tuition: failed to sync account status: %v", err)
	}

	return &ConnectStatus{
		AccountID:        acctID,
		DetailsSubmitted: acct.DetailsSubmitted,
		ChargesEnabled:   acct.ChargesEnabled,
		PayoutsEnabled:   acct.PayoutsEnabled,
		Status:           status,
	}, nil
}

// ============================================
// Tuition plans
// ============================================

var validIntervals = map[string]bool{"week": true, "month": true, "year": true}

// CreateTuitionPlan creates a Product+Price on the dojo's connected account
// and stores the plan in Firestore. Owner/staff only.
func (s *Service) CreateTuitionPlan(ctx context.Context, userUID string, in CreateTuitionPlanInput) (*TuitionPlan, error) {
	in.Trim()
	if in.DojoID == "" || in.Name == "" {
		return nil, fmt.Errorf("%w: dojoId and name are required", ErrBadRequest)
	}
	if in.Amount <= 0 {
		return nil, fmt.Errorf("%w: amount must be positive", ErrBadRequest)
	}
	if in.Currency == "" {
		in.Currency = "cad"
	}
	if in.Interval == "" {
		in.Interval = "month"
	}
	if !validIntervals[in.Interval] {
		return nil, fmt.Errorf("%w: interval must be week, month, or year", ErrBadRequest)
	}
	if err := s.requireRole(ctx, in.DojoID, userUID, "owner", "staff"); err != nil {
		return nil, err
	}

	acctID, _, err := s.connectAccountID(ctx, in.DojoID)
	if err != nil {
		return nil, err
	}

	params := &stripe.PriceParams{
		UnitAmount: stripe.Int64(in.Amount),
		Currency:   stripe.String(in.Currency),
		Recurring: &stripe.PriceRecurringParams{
			Interval: stripe.String(in.Interval),
		},
		ProductData: &stripe.PriceProductDataParams{
			Name: stripe.String(in.Name),
		},
		Metadata: map[string]string{
			"dojoId": in.DojoID,
		},
	}
	params.SetStripeAccount(acctID)

	p, err := price.New(params)
	if err != nil {
		return nil, fmt.Errorf("failed to create price: %w", err)
	}

	now := time.Now().UTC()
	plan := &TuitionPlan{
		Name:            in.Name,
		Description:     in.Description,
		Amount:          in.Amount,
		Currency:        in.Currency,
		Interval:        in.Interval,
		StripeProductID: p.Product.ID,
		StripePriceID:   p.ID,
		IsActive:        true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	ref, _, err := s.fs.Collection("dojos").Doc(in.DojoID).Collection("tuitionPlans").Add(ctx, plan)
	if err != nil {
		return nil, fmt.Errorf("failed to save plan: %w", err)
	}
	plan.ID = ref.ID
	return plan, nil
}

// ListTuitionPlans returns active plans. Any member of the dojo can list.
func (s *Service) ListTuitionPlans(ctx context.Context, userUID, dojoID string) ([]*TuitionPlan, error) {
	if _, err := s.memberDoc(ctx, dojoID, userUID); err != nil {
		return nil, err
	}

	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPlans").
		Where("isActive", "==", true).
		Documents(ctx)

	plans := []*TuitionPlan{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var p TuitionPlan
		if err := doc.DataTo(&p); err != nil {
			log.Printf("tuition: failed to parse plan %s: %v", doc.Ref.ID, err)
			continue
		}
		p.ID = doc.Ref.ID
		plans = append(plans, &p)
	}
	return plans, nil
}

// DeactivateTuitionPlan archives a plan (existing subscribers are NOT
// canceled; new signups are stopped). Owner/staff only.
func (s *Service) DeactivateTuitionPlan(ctx context.Context, userUID, dojoID, planID string) error {
	if err := s.requireRole(ctx, dojoID, userUID, "owner", "staff"); err != nil {
		return err
	}

	planRef := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPlans").Doc(planID)
	planDoc, err := planRef.Get(ctx)
	if err != nil || !planDoc.Exists() {
		return fmt.Errorf("%w: plan not found", ErrNotFound)
	}

	acctID, _, err := s.connectAccountID(ctx, dojoID)
	if err != nil {
		return err
	}

	if priceID, _ := planDoc.Data()["stripePriceId"].(string); priceID != "" {
		params := &stripe.PriceParams{Active: stripe.Bool(false)}
		params.SetStripeAccount(acctID)
		if _, err := price.Update(priceID, params); err != nil {
			log.Printf("tuition: failed to deactivate price %s: %v", priceID, err)
		}
	}

	_, err = planRef.Set(ctx, map[string]interface{}{
		"isActive":  false,
		"updatedAt": time.Now().UTC(),
	}, firestore.MergeAll)
	return err
}

// ============================================
// Member checkout / portal
// ============================================

// CreateCheckout starts a tuition subscription for the calling member via
// Stripe Checkout on the dojo's connected account.
func (s *Service) CreateCheckout(ctx context.Context, userUID string, in CreateTuitionCheckoutInput) (string, error) {
	in.Trim()
	if in.DojoID == "" || in.PlanID == "" {
		return "", fmt.Errorf("%w: dojoId and planId are required", ErrBadRequest)
	}
	if in.SuccessURL == "" || in.CancelURL == "" {
		return "", fmt.Errorf("%w: successUrl and cancelUrl are required", ErrBadRequest)
	}

	memberData, err := s.requireActiveMember(ctx, in.DojoID, userUID)
	if err != nil {
		return "", err
	}

	acctID, dojoData, err := s.connectAccountID(ctx, in.DojoID)
	if err != nil {
		return "", err
	}
	if status, _ := dojoData["stripeAccountStatus"].(string); status != "active" {
		// Double-check live state — webhook may not have synced yet.
		acct, aerr := account.GetByID(acctID, nil)
		if aerr != nil || !acct.ChargesEnabled {
			return "", fmt.Errorf("%w: this dojo cannot accept payments yet", ErrNotReady)
		}
	}

	// Already subscribed?
	if existing, _ := memberData["tuitionStatus"].(string); existing == "active" || existing == "past_due" {
		return "", fmt.Errorf("%w: you already have an active tuition subscription. Use the billing portal to make changes.", ErrBadRequest)
	}

	planDoc, err := s.fs.Collection("dojos").Doc(in.DojoID).Collection("tuitionPlans").Doc(in.PlanID).Get(ctx)
	if err != nil || !planDoc.Exists() {
		return "", fmt.Errorf("%w: plan not found", ErrNotFound)
	}
	planData := planDoc.Data()
	if active, _ := planData["isActive"].(bool); !active {
		return "", fmt.Errorf("%w: this plan is no longer available", ErrBadRequest)
	}
	priceID, _ := planData["stripePriceId"].(string)
	if priceID == "" {
		return "", fmt.Errorf("%w: plan is misconfigured", ErrBadRequest)
	}

	// Get or create the member's Customer on the CONNECTED account.
	// Customers are per-account: the platform-side customer cannot be reused.
	customerID, _ := memberData["tuitionCustomerId"].(string)
	if customerID != "" {
		getParams := &stripe.CustomerParams{}
		getParams.SetStripeAccount(acctID)
		if _, err := customer.Get(customerID, getParams); err != nil {
			log.Printf("tuition: stored customer %s invalid on account %s, recreating: %v", customerID, acctID, err)
			customerID = ""
		}
	}
	if customerID == "" {
		email, _ := memberData["email"].(string)
		name, _ := memberData["displayName"].(string)
		cparams := &stripe.CustomerParams{
			Metadata: map[string]string{
				"dojoId":    in.DojoID,
				"memberUid": userUID,
			},
		}
		if email != "" {
			cparams.Email = stripe.String(email)
		}
		if name != "" {
			cparams.Name = stripe.String(name)
		}
		cparams.SetStripeAccount(acctID)
		c, err := customer.New(cparams)
		if err != nil {
			return "", fmt.Errorf("failed to create customer: %w", err)
		}
		customerID = c.ID

		if _, err := s.fs.Collection("dojos").Doc(in.DojoID).Collection("members").Doc(userUID).Set(ctx, map[string]interface{}{
			"tuitionCustomerId": customerID,
		}, firestore.MergeAll); err != nil {
			log.Printf("tuition: failed to save customer id: %v", err)
		}
	}

	meta := map[string]string{
		"dojoId":    in.DojoID,
		"memberUid": userUID,
		"planId":    in.PlanID,
	}
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		SuccessURL: stripe.String(in.SuccessURL),
		CancelURL:  stripe.String(in.CancelURL),
		Metadata:   meta,
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: meta,
		},
		// Let the member enter a tuition promo code (e.g. a -$35/forever code
		// the owner gave them) on the Stripe-hosted checkout page. The code is
		// validated against promotion codes on THIS dojo's connected account.
		AllowPromotionCodes: stripe.Bool(true),
	}
	params.SetStripeAccount(acctID)

	session, err := checkoutsession.New(params)
	if err != nil {
		return "", fmt.Errorf("failed to create checkout session: %w", err)
	}
	return session.URL, nil
}

// CreatePortal opens the Stripe Billing Portal for the calling member on the
// dojo's connected account (card update, invoice history, cancel).
func (s *Service) CreatePortal(ctx context.Context, userUID string, in CreateTuitionPortalInput) (string, error) {
	in.Trim()
	if in.DojoID == "" || in.ReturnURL == "" {
		return "", fmt.Errorf("%w: dojoId and returnUrl are required", ErrBadRequest)
	}

	memberData, err := s.memberDoc(ctx, in.DojoID, userUID)
	if err != nil {
		return "", err
	}
	customerID, _ := memberData["tuitionCustomerId"].(string)
	if customerID == "" {
		return "", fmt.Errorf("%w: no tuition billing account found", ErrBadRequest)
	}

	acctID, dojoData, err := s.connectAccountID(ctx, in.DojoID)
	if err != nil {
		return "", err
	}

	// Connected accounts need a portal configuration created by the platform.
	// Create one lazily and cache the ID on the dojo doc.
	configID, _ := dojoData["tuitionPortalConfigId"].(string)
	if configID == "" {
		cfgParams := &stripe.BillingPortalConfigurationParams{
			Features: &stripe.BillingPortalConfigurationFeaturesParams{
				CustomerUpdate: &stripe.BillingPortalConfigurationFeaturesCustomerUpdateParams{
					Enabled:        stripe.Bool(true),
					AllowedUpdates: stripe.StringSlice([]string{"email"}),
				},
				InvoiceHistory: &stripe.BillingPortalConfigurationFeaturesInvoiceHistoryParams{
					Enabled: stripe.Bool(true),
				},
				PaymentMethodUpdate: &stripe.BillingPortalConfigurationFeaturesPaymentMethodUpdateParams{
					Enabled: stripe.Bool(true),
				},
				SubscriptionCancel: &stripe.BillingPortalConfigurationFeaturesSubscriptionCancelParams{
					Enabled: stripe.Bool(true),
					Mode:    stripe.String("at_period_end"),
				},
			},
			BusinessProfile: &stripe.BillingPortalConfigurationBusinessProfileParams{
				Headline: stripe.String("Manage your tuition subscription"),
			},
		}
		cfgParams.SetStripeAccount(acctID)
		cfg, err := portalconfiguration.New(cfgParams)
		if err != nil {
			return "", fmt.Errorf("failed to create portal configuration: %w", err)
		}
		configID = cfg.ID
		if _, err := s.fs.Collection("dojos").Doc(in.DojoID).Set(ctx, map[string]interface{}{
			"tuitionPortalConfigId": configID,
		}, firestore.MergeAll); err != nil {
			log.Printf("tuition: failed to save portal config id: %v", err)
		}
	}

	params := &stripe.BillingPortalSessionParams{
		Customer:      stripe.String(customerID),
		ReturnURL:     stripe.String(in.ReturnURL),
		Configuration: stripe.String(configID),
	}
	params.SetStripeAccount(acctID)

	session, err := portalsession.New(params)
	if err != nil {
		return "", fmt.Errorf("failed to create portal session: %w", err)
	}
	return session.URL, nil
}

// ============================================
// Owner-facing status & management
// ============================================

// ListMemberTuitionStatus returns the tuition status of all members.
// Owner/staff/coach only.
func (s *Service) ListMemberTuitionStatus(ctx context.Context, userUID, dojoID string) ([]*MemberTuition, error) {
	if err := s.requireRole(ctx, dojoID, userUID, "owner", "staff", "coach"); err != nil {
		return nil, err
	}

	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("members").
		Where("status", "==", "active").
		Documents(ctx)

	out := []*MemberTuition{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		data := doc.Data()

		mt := &MemberTuition{UID: doc.Ref.ID, Status: "none"}
		mt.DisplayName, _ = data["displayName"].(string)
		mt.Email, _ = data["email"].(string)
		mt.CustomerID, _ = data["tuitionCustomerId"].(string)
		mt.SubscriptionID, _ = data["tuitionSubscriptionId"].(string)
		if st, _ := data["tuitionStatus"].(string); st != "" {
			mt.Status = st
		}
		mt.PlanID, _ = data["tuitionPlanId"].(string)
		mt.CancelAtPeriodEnd, _ = data["tuitionCancelAtPeriodEnd"].(bool)
		if pe, ok := data["tuitionPeriodEnd"].(time.Time); ok {
			mt.PeriodEnd = &pe
		}
		out = append(out, mt)
	}
	return out, nil
}

// CancelMemberSubscription lets an owner cancel a member's tuition
// subscription at period end (e.g. member quit the dojo).
func (s *Service) CancelMemberSubscription(ctx context.Context, userUID, dojoID, memberUID string) error {
	if err := s.requireRole(ctx, dojoID, userUID, "owner"); err != nil {
		return err
	}

	memberData, err := s.memberDoc(ctx, dojoID, memberUID)
	if err != nil {
		return fmt.Errorf("%w: member not found", ErrNotFound)
	}
	subID, _ := memberData["tuitionSubscriptionId"].(string)
	if subID == "" {
		return fmt.Errorf("%w: member has no tuition subscription", ErrBadRequest)
	}

	acctID, _, err := s.connectAccountID(ctx, dojoID)
	if err != nil {
		return err
	}

	params := &stripe.SubscriptionParams{CancelAtPeriodEnd: stripe.Bool(true)}
	params.SetStripeAccount(acctID)
	if _, err := subscription.Update(subID, params); err != nil {
		return fmt.Errorf("failed to cancel subscription: %w", err)
	}

	_, err = s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Set(ctx, map[string]interface{}{
		"tuitionCancelAtPeriodEnd": true,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("tuition: failed to update cancelAtPeriodEnd: %v", err)
	}
	return nil
}