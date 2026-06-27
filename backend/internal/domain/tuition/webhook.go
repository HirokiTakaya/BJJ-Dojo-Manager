package tuition

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
	"google.golang.org/api/iterator"
)

// HandleConnectWebhook processes Stripe Connect webhooks (events that occur
// on connected accounts). This is a SEPARATE endpoint from the platform
// webhook: in the Stripe dashboard, create a webhook endpoint with
// "Listen to events on Connected accounts" checked, and use its signing
// secret as STRIPE_CONNECT_WEBHOOK_SECRET.
func (s *Service) HandleConnectWebhook(w http.ResponseWriter, r *http.Request) {
	const MaxBodyBytes = int64(65536)
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)

	payload, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("connect-webhook: error reading body: %v", err)
		http.Error(w, "Error reading request body", http.StatusServiceUnavailable)
		return
	}

	sigHeader := r.Header.Get("Stripe-Signature")
	event, err := webhook.ConstructEvent(payload, sigHeader, s.config.ConnectWebhookSecret)
	if err != nil {
		log.Printf("connect-webhook: signature verification failed: %v", err)
		http.Error(w, "Webhook signature verification failed", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	acctID := event.Account // which connected account (= which dojo)
	log.Printf("connect-webhook: type=%s id=%s account=%s", event.Type, event.ID, acctID)

	// Idempotency: skip already-processed events.
	evtRef := s.fs.Collection("connectStripeEvents").Doc(event.ID)
	if doc, err := evtRef.Get(ctx); err == nil && doc.Exists() {
		log.Printf("connect-webhook: event %s already processed, skipping", event.ID)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"received": true}`))
		return
	}

	switch event.Type {
	case "account.updated":
		var acct stripe.Account
		if err := json.Unmarshal(event.Data.Raw, &acct); err == nil {
			s.handleAccountUpdated(ctx, &acct)
		}

	case "checkout.session.completed":
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err == nil {
			s.handleTuitionCheckoutCompleted(ctx, acctID, &session)
		}

	case "customer.subscription.updated", "customer.subscription.created":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err == nil {
			s.handleTuitionSubscriptionUpdated(ctx, acctID, &sub)
		}

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err == nil {
			s.handleTuitionSubscriptionDeleted(ctx, acctID, &sub)
		}

	case "invoice.payment_succeeded":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err == nil {
			s.handleTuitionInvoice(ctx, acctID, &inv, "paid")
		}

	case "invoice.payment_failed":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err == nil {
			s.handleTuitionInvoice(ctx, acctID, &inv, "failed")
		}

	default:
		log.Printf("connect-webhook: unhandled event type: %s", event.Type)
	}

	// Mark processed (best effort).
	_, _ = evtRef.Set(ctx, map[string]interface{}{
		"type":        string(event.Type),
		"account":     acctID,
		"processedAt": time.Now().UTC(),
	})

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"received": true}`))
}

// ============================================
// Handlers
// ============================================

func (s *Service) handleAccountUpdated(ctx context.Context, acct *stripe.Account) {
	dojoID := acct.Metadata["dojoId"]
	if dojoID == "" {
		var err error
		dojoID, err = s.findDojoByAccount(ctx, acct.ID)
		if err != nil {
			log.Printf("connect-webhook: account.updated: no dojo for %s", acct.ID)
			return
		}
	}

	status := "pending"
	if acct.ChargesEnabled {
		status = "active"
	}
	if _, err := s.fs.Collection("dojos").Doc(dojoID).Set(ctx, map[string]interface{}{
		"stripeAccountStatus": status,
	}, firestore.MergeAll); err != nil {
		log.Printf("connect-webhook: failed to update account status: %v", err)
	}
}

func (s *Service) handleTuitionCheckoutCompleted(ctx context.Context, acctID string, session *stripe.CheckoutSession) {
	dojoID := session.Metadata["dojoId"]
	memberUID := session.Metadata["memberUid"]
	planID := session.Metadata["planId"]
	if dojoID == "" || memberUID == "" {
		log.Printf("connect-webhook: checkout completed missing metadata (session %s)", session.ID)
		return
	}

	update := map[string]interface{}{
		"tuitionStatus":            "active",
		"tuitionPlanId":            planID,
		"tuitionCancelAtPeriodEnd": false,
		"tuitionUpdatedAt":         time.Now().UTC(),
	}
	if session.Subscription != nil {
		update["tuitionSubscriptionId"] = session.Subscription.ID
	}
	if session.Customer != nil {
		update["tuitionCustomerId"] = session.Customer.ID
	}

	if _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Set(ctx, update, firestore.MergeAll); err != nil {
		log.Printf("connect-webhook: failed to save checkout result: %v", err)
	}
}

func (s *Service) handleTuitionSubscriptionUpdated(ctx context.Context, acctID string, sub *stripe.Subscription) {
	dojoID, memberUID, err := s.resolveSubscriptionMember(ctx, acctID, sub)
	if err != nil {
		log.Printf("connect-webhook: subscription updated: %v", err)
		return
	}

	update := map[string]interface{}{
		"tuitionSubscriptionId":    sub.ID,
		"tuitionStatus":            string(sub.Status),
		"tuitionCancelAtPeriodEnd": sub.CancelAtPeriodEnd,
		"tuitionPeriodEnd":         time.Unix(sub.CurrentPeriodEnd, 0).UTC(),
		"tuitionUpdatedAt":         time.Now().UTC(),
	}
	if planID := sub.Metadata["planId"]; planID != "" {
		update["tuitionPlanId"] = planID
	}

	if _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Set(ctx, update, firestore.MergeAll); err != nil {
		log.Printf("connect-webhook: failed to save subscription update: %v", err)
	}
}

func (s *Service) handleTuitionSubscriptionDeleted(ctx context.Context, acctID string, sub *stripe.Subscription) {
	dojoID, memberUID, err := s.resolveSubscriptionMember(ctx, acctID, sub)
	if err != nil {
		log.Printf("connect-webhook: subscription deleted: %v", err)
		return
	}

	update := map[string]interface{}{
		"tuitionStatus":            "canceled",
		"tuitionCancelAtPeriodEnd": false,
		"tuitionUpdatedAt":         time.Now().UTC(),
	}
	if _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Set(ctx, update, firestore.MergeAll); err != nil {
		log.Printf("connect-webhook: failed to save subscription deletion: %v", err)
	}
}

func (s *Service) handleTuitionInvoice(ctx context.Context, acctID string, inv *stripe.Invoice, status string) {
	// Metadata lives on the subscription; invoices expose it via
	// SubscriptionDetails.Metadata.
	var dojoID, memberUID string
	if inv.SubscriptionDetails != nil {
		dojoID = inv.SubscriptionDetails.Metadata["dojoId"]
		memberUID = inv.SubscriptionDetails.Metadata["memberUid"]
	}
	subID := ""
	if inv.Subscription != nil {
		subID = inv.Subscription.ID
	}
	if dojoID == "" || memberUID == "" {
		var err error
		dojoID, memberUID, err = s.lookupMemberBySubscription(ctx, acctID, subID)
		if err != nil {
			log.Printf("connect-webhook: invoice %s: %v", inv.ID, err)
			return
		}
	}

	// Payment history record (doc ID = invoice ID → naturally idempotent).
	payment := map[string]interface{}{
		"memberUid":      memberUID,
		"subscriptionId": subID,
		"amount":         inv.AmountPaid,
		"currency":       string(inv.Currency),
		"status":         status,
		"invoiceUrl":     inv.HostedInvoiceURL,
		"invoicePdf":     inv.InvoicePDF,
		"createdAt":      time.Unix(inv.Created, 0).UTC(),
	}
	if status == "failed" {
		payment["amount"] = inv.AmountDue
	}
	if _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionPayments").Doc(inv.ID).Set(ctx, payment); err != nil {
		log.Printf("connect-webhook: failed to save payment record: %v", err)
	}

	// Reflect member status.
	memberUpdate := map[string]interface{}{
		"tuitionUpdatedAt": time.Now().UTC(),
	}
	if status == "paid" {
		memberUpdate["tuitionStatus"] = "active"
		memberUpdate["tuitionLastPaidAt"] = time.Unix(inv.Created, 0).UTC()
	} else {
		memberUpdate["tuitionStatus"] = "past_due"
	}
	if _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID).Set(ctx, memberUpdate, firestore.MergeAll); err != nil {
		log.Printf("connect-webhook: failed to update member tuition status: %v", err)
	}

	// Notify the dojo on failed payments so owners can follow up
	// (rides on the same notifications collection pattern).
	if status == "failed" {
		notice := map[string]interface{}{
			"type":      "tuition_payment_failed",
			"memberUid": memberUID,
			"invoiceId": inv.ID,
			"amount":    inv.AmountDue,
			"currency":  string(inv.Currency),
			"createdAt": time.Now().UTC(),
			"read":      false,
		}
		if _, _, err := s.fs.Collection("dojos").Doc(dojoID).Collection("tuitionAlerts").Add(ctx, notice); err != nil {
			log.Printf("connect-webhook: failed to create tuition alert: %v", err)
		}
	}
}

// ============================================
// Lookup helpers
// ============================================

// resolveSubscriptionMember finds (dojoID, memberUID) for a subscription,
// preferring metadata and falling back to a Firestore query.
func (s *Service) resolveSubscriptionMember(ctx context.Context, acctID string, sub *stripe.Subscription) (string, string, error) {
	dojoID := sub.Metadata["dojoId"]
	memberUID := sub.Metadata["memberUid"]
	if dojoID != "" && memberUID != "" {
		return dojoID, memberUID, nil
	}
	return s.lookupMemberBySubscription(ctx, acctID, sub.ID)
}

// lookupMemberBySubscription resolves the dojo from the connected account ID,
// then finds the member holding the subscription.
func (s *Service) lookupMemberBySubscription(ctx context.Context, acctID, subID string) (string, string, error) {
	if acctID == "" || subID == "" {
		return "", "", fmt.Errorf("missing account or subscription id")
	}
	dojoID, err := s.findDojoByAccount(ctx, acctID)
	if err != nil {
		return "", "", err
	}

	iter := s.fs.Collection("dojos").Doc(dojoID).Collection("members").
		Where("tuitionSubscriptionId", "==", subID).
		Limit(1).
		Documents(ctx)
	doc, err := iter.Next()
	if err == iterator.Done {
		return "", "", fmt.Errorf("no member with subscription %s in dojo %s", subID, dojoID)
	}
	if err != nil {
		return "", "", err
	}
	return dojoID, doc.Ref.ID, nil
}

// findDojoByAccount finds the dojo whose stripeAccountId matches.
func (s *Service) findDojoByAccount(ctx context.Context, acctID string) (string, error) {
	iter := s.fs.Collection("dojos").
		Where("stripeAccountId", "==", acctID).
		Limit(1).
		Documents(ctx)
	doc, err := iter.Next()
	if err == iterator.Done {
		return "", fmt.Errorf("no dojo with stripe account %s", acctID)
	}
	if err != nil {
		return "", err
	}
	return doc.Ref.ID, nil
}
