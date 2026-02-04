package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/webhook"
)

// HandleWebhook processes incoming Stripe webhooks
func (s *Service) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	const MaxBodyBytes = int64(65536)
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)

	payload, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("webhook: error reading request body: %v", err)
		http.Error(w, "Error reading request body", http.StatusServiceUnavailable)
		return
	}

	// Verify webhook signature
	sigHeader := r.Header.Get("Stripe-Signature")
	event, err := webhook.ConstructEvent(payload, sigHeader, s.config.WebhookSecret)
	if err != nil {
		log.Printf("webhook: signature verification failed: %v", err)
		http.Error(w, fmt.Sprintf("Webhook signature verification failed: %v", err), http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	log.Printf("webhook: received event type=%s id=%s", event.Type, event.ID)

	// Handle the event
	switch event.Type {
	case "checkout.session.completed":
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
			log.Printf("webhook: error parsing checkout session: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handleCheckoutCompleted(ctx, &session); err != nil {
			log.Printf("webhook: error handling checkout completed: %v", err)
			// Don't return error - acknowledge receipt to prevent retries
		}

	case "customer.subscription.created":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			log.Printf("webhook: error parsing subscription: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handleSubscriptionCreated(ctx, &sub); err != nil {
			log.Printf("webhook: error handling subscription created: %v", err)
		}

	case "customer.subscription.updated":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			log.Printf("webhook: error parsing subscription: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handleSubscriptionUpdated(ctx, &sub); err != nil {
			log.Printf("webhook: error handling subscription updated: %v", err)
		}

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			log.Printf("webhook: error parsing subscription: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handleSubscriptionDeleted(ctx, &sub); err != nil {
			log.Printf("webhook: error handling subscription deleted: %v", err)
		}

	case "invoice.payment_succeeded":
		var invoice stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			log.Printf("webhook: error parsing invoice: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handlePaymentSucceeded(ctx, &invoice); err != nil {
			log.Printf("webhook: error handling payment succeeded: %v", err)
		}

	case "invoice.payment_failed":
		var invoice stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			log.Printf("webhook: error parsing invoice: %v", err)
			http.Error(w, fmt.Sprintf("Error parsing webhook JSON: %v", err), http.StatusBadRequest)
			return
		}
		if err := s.handlePaymentFailed(ctx, &invoice); err != nil {
			log.Printf("webhook: error handling payment failed: %v", err)
		}

	default:
		log.Printf("webhook: unhandled event type: %s", event.Type)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"received": true}`))
}

func (s *Service) handleCheckoutCompleted(ctx context.Context, session *stripe.CheckoutSession) error {
	dojoID := session.Metadata["dojoId"]
	if dojoID == "" {
		return fmt.Errorf("missing dojoId in metadata")
	}

	log.Printf("webhook: checkout completed for dojo=%s subscription=%s", dojoID, session.Subscription.ID)

	// Update dojo with customer and subscription ID immediately
	// The subscription.created webhook will handle the rest
	_, err := s.fs.Collection("dojos").Doc(dojoID).Set(ctx, map[string]interface{}{
		"stripeCustomerId": session.Customer.ID,
		"subscriptionId":   session.Subscription.ID,
		"updatedAt":        time.Now().UTC(),
	}, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("failed to update dojo: %w", err)
	}

	return nil
}

func (s *Service) handleSubscriptionCreated(ctx context.Context, sub *stripe.Subscription) error {
	dojoID := sub.Metadata["dojoId"]
	if dojoID == "" {
		// Try to find dojo by customer ID
		dojoID = s.findDojoByCustomer(ctx, sub.Customer.ID)
		if dojoID == "" {
			return fmt.Errorf("missing dojoId in metadata and could not find by customer")
		}
	}

	priceID := ""
	if len(sub.Items.Data) > 0 {
		priceID = sub.Items.Data[0].Price.ID
	}

	plan := s.GetPlanFromPriceID(priceID)
	periodEnd := time.Unix(sub.CurrentPeriodEnd, 0).UTC()

	log.Printf("webhook: subscription created dojo=%s plan=%s status=%s", dojoID, plan, sub.Status)

	// Update dojo with subscription info
	_, err := s.fs.Collection("dojos").Doc(dojoID).Update(ctx, []firestore.Update{
		{Path: "subscriptionId", Value: sub.ID},
		{Path: "subscriptionStatus", Value: string(sub.Status)},
		{Path: "subscriptionPriceId", Value: priceID},
		{Path: "plan", Value: plan},
		{Path: "planPeriodEnd", Value: periodEnd},
		{Path: "cancelAtPeriodEnd", Value: sub.CancelAtPeriodEnd},
		{Path: "updatedAt", Value: time.Now().UTC()},
	})
	if err != nil {
		return fmt.Errorf("failed to update dojo: %w", err)
	}

	// Record subscription event
	s.recordSubscriptionEvent(ctx, dojoID, SubscriptionEvent{
		Type:              "subscription_created",
		SubscriptionID:    sub.ID,
		Status:            string(sub.Status),
		Plan:              plan,
		PriceID:           priceID,
		PeriodEnd:         periodEnd,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		CreatedAt:         time.Now().UTC(),
	})

	return nil
}

func (s *Service) handleSubscriptionUpdated(ctx context.Context, sub *stripe.Subscription) error {
	dojoID := sub.Metadata["dojoId"]
	if dojoID == "" {
		// Try to find dojo by subscription ID
		dojoID = s.findDojoBySubscription(ctx, sub.ID)
		if dojoID == "" {
			// Try by customer ID
			dojoID = s.findDojoByCustomer(ctx, sub.Customer.ID)
			if dojoID == "" {
				return fmt.Errorf("could not find dojo for subscription %s", sub.ID)
			}
		}
	}

	priceID := ""
	if len(sub.Items.Data) > 0 {
		priceID = sub.Items.Data[0].Price.ID
	}

	plan := s.GetPlanFromPriceID(priceID)
	periodEnd := time.Unix(sub.CurrentPeriodEnd, 0).UTC()

	log.Printf("webhook: subscription updated dojo=%s plan=%s status=%s cancelAtPeriodEnd=%v",
		dojoID, plan, sub.Status, sub.CancelAtPeriodEnd)

	// Update dojo
	_, err := s.fs.Collection("dojos").Doc(dojoID).Update(ctx, []firestore.Update{
		{Path: "subscriptionStatus", Value: string(sub.Status)},
		{Path: "subscriptionPriceId", Value: priceID},
		{Path: "plan", Value: plan},
		{Path: "planPeriodEnd", Value: periodEnd},
		{Path: "cancelAtPeriodEnd", Value: sub.CancelAtPeriodEnd},
		{Path: "updatedAt", Value: time.Now().UTC()},
	})
	if err != nil {
		return fmt.Errorf("failed to update dojo: %w", err)
	}

	// Record event
	s.recordSubscriptionEvent(ctx, dojoID, SubscriptionEvent{
		Type:              "subscription_updated",
		SubscriptionID:    sub.ID,
		Status:            string(sub.Status),
		Plan:              plan,
		PriceID:           priceID,
		PeriodEnd:         periodEnd,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		CreatedAt:         time.Now().UTC(),
	})

	return nil
}

func (s *Service) handleSubscriptionDeleted(ctx context.Context, sub *stripe.Subscription) error {
	dojoID := sub.Metadata["dojoId"]
	if dojoID == "" {
		// Try to find dojo by subscription ID
		dojoID = s.findDojoBySubscription(ctx, sub.ID)
		if dojoID == "" {
			dojoID = s.findDojoByCustomer(ctx, sub.Customer.ID)
			if dojoID == "" {
				return fmt.Errorf("could not find dojo for subscription %s", sub.ID)
			}
		}
	}

	log.Printf("webhook: subscription deleted dojo=%s", dojoID)

	// Update dojo - reset to free plan
	_, err := s.fs.Collection("dojos").Doc(dojoID).Update(ctx, []firestore.Update{
		{Path: "subscriptionId", Value: nil},
		{Path: "subscriptionStatus", Value: "canceled"},
		{Path: "subscriptionPriceId", Value: nil},
		{Path: "plan", Value: PlanFree},
		{Path: "planPeriodEnd", Value: nil},
		{Path: "cancelAtPeriodEnd", Value: false},
		{Path: "updatedAt", Value: time.Now().UTC()},
	})
	if err != nil {
		return fmt.Errorf("failed to update dojo: %w", err)
	}

	// Record event
	s.recordSubscriptionEvent(ctx, dojoID, SubscriptionEvent{
		Type:           "subscription_deleted",
		SubscriptionID: sub.ID,
		Status:         string(sub.Status),
		Plan:           PlanFree,
		CreatedAt:      time.Now().UTC(),
	})

	return nil
}

func (s *Service) handlePaymentSucceeded(ctx context.Context, invoice *stripe.Invoice) error {
	if invoice.Subscription == nil {
		return nil // Not a subscription invoice
	}

	// Find dojo by subscription ID first
	dojoID := s.findDojoBySubscription(ctx, invoice.Subscription.ID)
	if dojoID == "" {
		// Try metadata
		dojoID = invoice.Metadata["dojoId"]
		if dojoID == "" {
			// Try by customer
			dojoID = s.findDojoByCustomer(ctx, invoice.Customer.ID)
			if dojoID == "" {
				return fmt.Errorf("could not find dojo for subscription %s", invoice.Subscription.ID)
			}
		}
	}

	log.Printf("webhook: payment succeeded dojo=%s amount=%d", dojoID, invoice.AmountPaid)

	// Record payment
	paymentDoc := s.fs.Collection("dojos").Doc(dojoID).Collection("payments").NewDoc()
	_, err := paymentDoc.Set(ctx, Payment{
		ID:             paymentDoc.ID,
		InvoiceID:      invoice.ID,
		SubscriptionID: invoice.Subscription.ID,
		Amount:         invoice.AmountPaid,
		Currency:       string(invoice.Currency),
		Status:         "succeeded",
		InvoiceURL:     invoice.HostedInvoiceURL,
		InvoicePDF:     invoice.InvoicePDF,
		CreatedAt:      time.Now().UTC(),
	})
	if err != nil {
		return fmt.Errorf("failed to record payment: %w", err)
	}

	return nil
}

func (s *Service) handlePaymentFailed(ctx context.Context, invoice *stripe.Invoice) error {
	if invoice.Subscription == nil {
		return nil
	}

	// Find dojo
	dojoID := s.findDojoBySubscription(ctx, invoice.Subscription.ID)
	if dojoID == "" {
		dojoID = s.findDojoByCustomer(ctx, invoice.Customer.ID)
		if dojoID == "" {
			log.Printf("webhook: payment failed but could not find dojo for subscription %s", invoice.Subscription.ID)
			return nil // Don't error, just log
		}
	}

	log.Printf("webhook: payment failed dojo=%s amount=%d", dojoID, invoice.AmountDue)

	// Record failed payment
	paymentDoc := s.fs.Collection("dojos").Doc(dojoID).Collection("payments").NewDoc()
	_, err := paymentDoc.Set(ctx, Payment{
		ID:             paymentDoc.ID,
		InvoiceID:      invoice.ID,
		SubscriptionID: invoice.Subscription.ID,
		Amount:         invoice.AmountDue,
		Currency:       string(invoice.Currency),
		Status:         "failed",
		InvoiceURL:     invoice.HostedInvoiceURL,
		CreatedAt:      time.Now().UTC(),
	})
	if err != nil {
		log.Printf("webhook: failed to record payment: %v", err)
	}

	// Update subscription status
	_, err = s.fs.Collection("dojos").Doc(dojoID).Update(ctx, []firestore.Update{
		{Path: "subscriptionStatus", Value: "past_due"},
		{Path: "updatedAt", Value: time.Now().UTC()},
	})
	if err != nil {
		return fmt.Errorf("failed to update dojo: %w", err)
	}

	return nil
}

// Helper functions

func (s *Service) findDojoBySubscription(ctx context.Context, subscriptionID string) string {
	iter := s.fs.Collection("dojos").Where("subscriptionId", "==", subscriptionID).Limit(1).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil || len(docs) == 0 {
		return ""
	}
	return docs[0].Ref.ID
}

func (s *Service) findDojoByCustomer(ctx context.Context, customerID string) string {
	iter := s.fs.Collection("dojos").Where("stripeCustomerId", "==", customerID).Limit(1).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil || len(docs) == 0 {
		return ""
	}
	return docs[0].Ref.ID
}

func (s *Service) recordSubscriptionEvent(ctx context.Context, dojoID string, event SubscriptionEvent) {
	eventDoc := s.fs.Collection("dojos").Doc(dojoID).Collection("subscriptionEvents").NewDoc()
	event.ID = eventDoc.ID
	_, err := eventDoc.Set(ctx, event)
	if err != nil {
		log.Printf("webhook: failed to record subscription event: %v", err)
	}
}
