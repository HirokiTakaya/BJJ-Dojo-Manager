package stripe

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/stripe/stripe-go/v76"
	portalsession "github.com/stripe/stripe-go/v76/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v76/checkout/session"
	"github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/subscription"
	"google.golang.org/api/iterator"
)

type Config struct {
	SecretKey             string
	WebhookSecret         string
	PriceProMonthly       string
	PriceProYearly        string
	PriceBusinessMonthly  string
	PriceBusinessYearly   string
}

func LoadConfig() Config {
	return Config{
		SecretKey:             os.Getenv("STRIPE_SECRET_KEY"),
		WebhookSecret:         os.Getenv("STRIPE_WEBHOOK_SECRET"),
		PriceProMonthly:       os.Getenv("STRIPE_PRICE_PRO_MONTHLY"),
		PriceProYearly:        os.Getenv("STRIPE_PRICE_PRO_YEARLY"),
		PriceBusinessMonthly:  os.Getenv("STRIPE_PRICE_BUSINESS_MONTHLY"),
		PriceBusinessYearly:   os.Getenv("STRIPE_PRICE_BUSINESS_YEARLY"),
	}
}

type Service struct {
	fs     *firestore.Client
	config Config
}

func NewService(fs *firestore.Client, cfg Config) *Service {
	stripe.Key = cfg.SecretKey
	return &Service{fs: fs, config: cfg}
}

func (s *Service) CreateCheckoutSession(ctx context.Context, userUID string, input CreateCheckoutInput) (string, error) {
	input.Trim()

	if input.DojoID == "" {
		return "", fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}
	if input.Plan != "pro" && input.Plan != "business" {
		return "", fmt.Errorf("%w: plan must be 'pro' or 'business'", ErrBadRequest)
	}
	if input.Period != "monthly" && input.Period != "yearly" {
		return "", fmt.Errorf("%w: period must be 'monthly' or 'yearly'", ErrBadRequest)
	}

	dojoDoc, err := s.fs.Collection("dojos").Doc(input.DojoID).Get(ctx)
	if err != nil {
		return "", fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	dojoData := dojoDoc.Data()
	dojoName, _ := dojoData["name"].(string)
	stripeCustomerID, _ := dojoData["stripeCustomerId"].(string)

	userDoc, _ := s.fs.Collection("users").Doc(userUID).Get(ctx)
	var email string
	if userDoc != nil && userDoc.Exists() {
		email, _ = userDoc.Data()["email"].(string)
	}

	if stripeCustomerID == "" {
		params := &stripe.CustomerParams{
			Email: stripe.String(email),
			Name:  stripe.String(dojoName),
			Metadata: map[string]string{
				"dojoId":  input.DojoID,
				"userUid": userUID,
			},
		}
		c, err := customer.New(params)
		if err != nil {
			return "", fmt.Errorf("failed to create customer: %w", err)
		}
		stripeCustomerID = c.ID

		_, err = s.fs.Collection("dojos").Doc(input.DojoID).Set(ctx, map[string]interface{}{
			"stripeCustomerId": stripeCustomerID,
		}, firestore.MergeAll)
		if err != nil {
			log.Printf("failed to save customer id: %v", err)
		}
	}

	var priceID string
	if input.Plan == "pro" {
		if input.Period == "yearly" {
			priceID = s.config.PriceProYearly
		} else {
			priceID = s.config.PriceProMonthly
		}
	} else {
		if input.Period == "yearly" {
			priceID = s.config.PriceBusinessYearly
		} else {
			priceID = s.config.PriceBusinessMonthly
		}
	}

	if priceID == "" {
		return "", fmt.Errorf("%w: price not configured for %s %s", ErrBadRequest, input.Plan, input.Period)
	}

	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(stripeCustomerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL: stripe.String(input.SuccessURL),
		CancelURL:  stripe.String(input.CancelURL),
		Metadata: map[string]string{
			"dojoId": input.DojoID,
			"plan":   input.Plan,
		},
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{
				"dojoId": input.DojoID,
				"plan":   input.Plan,
			},
		},
	}

	session, err := checkoutsession.New(params)
	if err != nil {
		return "", fmt.Errorf("failed to create checkout session: %w", err)
	}

	return session.URL, nil
}

func (s *Service) CreatePortalSession(ctx context.Context, userUID string, input CreatePortalInput) (string, error) {
	input.Trim()

	if input.DojoID == "" {
		return "", fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	dojoDoc, err := s.fs.Collection("dojos").Doc(input.DojoID).Get(ctx)
	if err != nil {
		return "", fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	dojoData := dojoDoc.Data()
	stripeCustomerID, _ := dojoData["stripeCustomerId"].(string)

	if stripeCustomerID == "" {
		return "", fmt.Errorf("%w: no billing account found", ErrBadRequest)
	}

	params := &stripe.BillingPortalSessionParams{
		Customer:  stripe.String(stripeCustomerID),
		ReturnURL: stripe.String(input.ReturnURL),
	}

	session, err := portalsession.New(params)
	if err != nil {
		return "", fmt.Errorf("failed to create portal session: %w", err)
	}

	return session.URL, nil
}

func (s *Service) GetSubscriptionInfo(ctx context.Context, dojoID string) (*SubscriptionInfo, error) {
	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	dojoData := dojoDoc.Data()

	plan, _ := dojoData["plan"].(string)
	if plan == "" {
		plan = "free"
	}

	status, _ := dojoData["subscriptionStatus"].(string)
	if status == "" {
		status = "none"
	}

	var periodEnd *time.Time
	if pe, ok := dojoData["planPeriodEnd"].(time.Time); ok {
		periodEnd = &pe
	}

	cancelAtPeriodEnd, _ := dojoData["cancelAtPeriodEnd"].(bool)

	memberCount, _ := s.countMembers(ctx, dojoID)
	staffCount, _ := s.countStaff(ctx, dojoID)
	announcementCount, _ := s.countAnnouncements(ctx, dojoID)
	classCount, _ := s.countClasses(ctx, dojoID)

	limits := GetPlanLimits(plan)

	return &SubscriptionInfo{
		Plan:              plan,
		Status:            status,
		PeriodEnd:         periodEnd,
		CancelAtPeriodEnd: cancelAtPeriodEnd,
		Usage: UsageInfo{
			Members: ResourceUsage{
				Current: memberCount,
				Limit:   limits.Members,
			},
			Staff: ResourceUsage{
				Current: staffCount,
				Limit:   limits.Staff,
			},
			Announcements: ResourceUsage{
				Current: announcementCount,
				Limit:   limits.Announcements,
			},
			Classes: ResourceUsage{
				Current: classCount,
				Limit:   limits.Classes,
			},
		},
	}, nil
}

func (s *Service) CancelSubscription(ctx context.Context, userUID, dojoID string) error {
	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		return fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	dojoData := dojoDoc.Data()
	subscriptionID, _ := dojoData["subscriptionId"].(string)

	if subscriptionID == "" {
		return fmt.Errorf("%w: no subscription found", ErrBadRequest)
	}

	params := &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	}

	_, err = subscription.Update(subscriptionID, params)
	if err != nil {
		return fmt.Errorf("failed to cancel subscription: %w", err)
	}

	_, err = s.fs.Collection("dojos").Doc(dojoID).Set(ctx, map[string]interface{}{
		"cancelAtPeriodEnd": true,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("failed to update cancelAtPeriodEnd: %v", err)
	}

	return nil
}

func (s *Service) ResumeSubscription(ctx context.Context, userUID, dojoID string) error {
	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		return fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	dojoData := dojoDoc.Data()
	subscriptionID, _ := dojoData["subscriptionId"].(string)

	if subscriptionID == "" {
		return fmt.Errorf("%w: no subscription found", ErrBadRequest)
	}

	params := &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(false),
	}

	_, err = subscription.Update(subscriptionID, params)
	if err != nil {
		return fmt.Errorf("failed to resume subscription: %w", err)
	}

	_, err = s.fs.Collection("dojos").Doc(dojoID).Set(ctx, map[string]interface{}{
		"cancelAtPeriodEnd": false,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("failed to update cancelAtPeriodEnd: %v", err)
	}

	return nil
}

func (s *Service) CheckPlanLimit(ctx context.Context, dojoID, resource string) error {
	dojoDoc, err := s.fs.Collection("dojos").Doc(dojoID).Get(ctx)
	if err != nil {
		log.Printf("CheckPlanLimit: dojo not found %s, allowing", dojoID)
		return nil
	}

	dojoData := dojoDoc.Data()
	plan, _ := dojoData["plan"].(string)
	if plan == "" {
		plan = "free"
	}

	limits := GetPlanLimits(plan)
	var limit int
	var current int

	switch resource {
	case "member":
		limit = limits.Members
		current, _ = s.countMembers(ctx, dojoID)
	case "staff":
		limit = limits.Staff
		current, _ = s.countStaff(ctx, dojoID)
	case "announcement":
		limit = limits.Announcements
		current, _ = s.countAnnouncements(ctx, dojoID)
	case "class":
		limit = limits.Classes
		current, _ = s.countClasses(ctx, dojoID)
	default:
		return nil
	}

	if limit == -1 {
		return nil
	}

	if current >= limit {
		return fmt.Errorf("%w: %s limit reached (%d/%d). Upgrade your plan to add more.",
			ErrLimitReached, resource, current, limit)
	}

	return nil
}

func (s *Service) GetPlanFromPriceID(priceID string) string {
	switch priceID {
	case s.config.PriceProMonthly, s.config.PriceProYearly:
		return PlanPro
	case s.config.PriceBusinessMonthly, s.config.PriceBusinessYearly:
		return PlanBusiness
	default:
		return PlanFree
	}
}

func (s *Service) countMembers(ctx context.Context, dojoID string) (int, error) {
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("members").
		Where("status", "==", "active").
		Documents(ctx)
	return countDocs(iter)
}

func (s *Service) countStaff(ctx context.Context, dojoID string) (int, error) {
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("members").
		Where("roleInDojo", "in", []string{"staff", "coach", "owner"}).
		Documents(ctx)
	return countDocs(iter)
}

func (s *Service) countAnnouncements(ctx context.Context, dojoID string) (int, error) {
	now := time.Now().UTC()
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("notices").
		Where("status", "==", "active").
		Where("publishAt", "<=", now).
		Documents(ctx)

	count := 0
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return 0, err
		}

		data := doc.Data()
		if expireAt, ok := data["expireAt"].(time.Time); ok {
			if expireAt.Before(now) {
				continue
			}
		}
		count++
	}
	return count, nil
}

func (s *Service) countClasses(ctx context.Context, dojoID string) (int, error) {
	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("timetableClasses").
		Where("isActive", "==", true).
		Documents(ctx)
	return countDocs(iter)
}

func countDocs(iter *firestore.DocumentIterator) (int, error) {
	count := 0
	for {
		_, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return 0, err
		}
		count++
	}
	return count, nil
}