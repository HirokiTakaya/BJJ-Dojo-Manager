package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"cloud.google.com/go/firestore" // ✅ 追加（Mergeで使う）

	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/firebase"
	"dojo-manager/backend/internal/httpjson"

	"github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/checkout/session"
	"github.com/stripe/stripe-go/v78/customer"   // ✅ 追加
	"github.com/stripe/stripe-go/v78/refund"
	"github.com/stripe/stripe-go/v78/setupintent" // ✅ 追加
	"github.com/stripe/stripe-go/v78/webhook"
)

type Stripe struct {
	cfg     config.Config
	clients *firebase.Clients
}

func NewStripe(cfg config.Config, clients *firebase.Clients) *Stripe {
	return &Stripe{cfg: cfg, clients: clients}
}

// Webhook handles Stripe webhook events.
func (h *Stripe) Webhook(w http.ResponseWriter, r *http.Request) {
	if h.cfg.StripeWebhookSecret == "" {
		http.Error(w, "stripe webhook not configured", http.StatusNotImplemented)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewBuffer(body))

	event, err := webhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), h.cfg.StripeWebhookSecret)
	if err != nil {
		http.Error(w, "signature verification failed", http.StatusBadRequest)
		return
	}

	_, _ = h.clients.Firestore.Collection("stripeEvents").Doc(event.ID).Set(r.Context(), map[string]interface{}{
		"type":       event.Type,
		"created":    event.Created,
		"livemode":   event.Livemode,
		"receivedAt": time.Now(),
	})

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"received":true}`))
}

type checkoutReq struct {
	SuccessURL    string            `json:"successUrl"`
	CancelURL     string            `json:"cancelUrl"`
	PriceID       string            `json:"priceId"`
	Quantity      int64             `json:"quantity"`
	CustomerEmail string            `json:"customerEmail,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

func (h *Stripe) CreateCheckoutSession(w http.ResponseWriter, r *http.Request) {
	if h.cfg.StripeSecretKey == "" {
		httpjson.Error(w, http.StatusNotImplemented, "STRIPE_SECRET_KEY not set")
		return
	}
	stripe.Key = h.cfg.StripeSecretKey

	var req checkoutReq
	if err := httpjson.Read(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.SuccessURL == "" || req.CancelURL == "" || req.PriceID == "" {
		httpjson.Error(w, http.StatusBadRequest, "successUrl, cancelUrl, priceId required")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}

	params := &stripe.CheckoutSessionParams{
		SuccessURL: stripe.String(req.SuccessURL),
		CancelURL:  stripe.String(req.CancelURL),
		Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(req.PriceID),
				Quantity: stripe.Int64(req.Quantity),
			},
		},
	}
	if req.CustomerEmail != "" {
		params.CustomerEmail = stripe.String(req.CustomerEmail)
	}
	if len(req.Metadata) > 0 {
		params.Metadata = req.Metadata
	}

	sess, err := session.New(params)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to create checkout session")
		return
	}

	_, _ = h.clients.Firestore.Collection("payments").Doc(sess.ID).Set(r.Context(), map[string]interface{}{
		"stripeSessionId": sess.ID,
		"status":          "created",
		"createdAt":       time.Now(),
		"metadata":        req.Metadata,
	})

	httpjson.Write(w, http.StatusOK, map[string]interface{}{"id": sess.ID, "url": sess.URL})
}

type refundReq struct {
	PaymentIntentID string `json:"paymentIntentId"`
	Reason          string `json:"reason,omitempty"`
}

func (h *Stripe) IssueRefund(w http.ResponseWriter, r *http.Request) {
	if h.cfg.StripeSecretKey == "" {
		httpjson.Error(w, http.StatusNotImplemented, "STRIPE_SECRET_KEY not set")
		return
	}
	stripe.Key = h.cfg.StripeSecretKey

	var req refundReq
	if err := httpjson.Read(r, &req); err != nil || req.PaymentIntentID == "" {
		httpjson.Error(w, http.StatusBadRequest, "paymentIntentId required")
		return
	}

	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(req.PaymentIntentID),
	}
	if req.Reason != "" {
		params.Reason = stripe.String(req.Reason)
	}

	rf, err := refund.New(params)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "refund failed")
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":     rf.ID,
		"status": rf.Status,
	})
}

/* =========================================================
   ✅ ここから追加：カード登録（SetupIntent）
   ========================================================= */

type createSetupIntentReq struct {
	DojoID        string `json:"dojoId"`
	CustomerEmail string `json:"customerEmail,omitempty"`
}

type createSetupIntentResp struct {
	ClientSecret string `json:"clientSecret"`
	CustomerID   string `json:"customerId"`
}

// CreateSetupIntent: アプリ内カード入力用に SetupIntent を作る
func (h *Stripe) CreateSetupIntent(w http.ResponseWriter, r *http.Request) {
	if h.cfg.StripeSecretKey == "" {
		httpjson.Error(w, http.StatusNotImplemented, "STRIPE_SECRET_KEY not set")
		return
	}
	stripe.Key = h.cfg.StripeSecretKey

	var req createSetupIntentReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId required")
		return
	}

	ctx := r.Context()
	dojoRef := h.clients.Firestore.Collection("dojos").Doc(req.DojoID)

	// 1) 既存 customer を Firestore から探す
	var customerID string
	if snap, err := dojoRef.Get(ctx); err == nil && snap.Exists() {
		if v, ok := snap.Data()["stripeCustomerId"].(string); ok {
			customerID = v
		}
	}

	// 2) 無ければ Stripe Customer を作る
	if customerID == "" {
		cp := &stripe.CustomerParams{
			Metadata: map[string]string{
				"dojoId": req.DojoID,
			},
		}
		if req.CustomerEmail != "" {
			cp.Email = stripe.String(req.CustomerEmail)
		}

		cus, err := customer.New(cp)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "failed to create customer")
			return
		}
		customerID = cus.ID

		// dojos/{dojoId} に保存（他フィールドを壊さないよう Merge）
		_, _ = dojoRef.Set(ctx, map[string]interface{}{
			"stripeCustomerId": customerID,
		}, firestore.MergeAll)
	}

	// 3) SetupIntent 作成（off_session＝サブスク請求に使える）
	sip := &stripe.SetupIntentParams{
		Customer: stripe.String(customerID),
		PaymentMethodTypes: stripe.StringSlice([]string{
			"card",
		}),
		Usage: stripe.String(string(stripe.SetupIntentUsageOffSession)),
		Metadata: map[string]string{
			"dojoId": req.DojoID,
		},
	}

	si, err := setupintent.New(sip)
	if err != nil || si.ClientSecret == "" {
		httpjson.Error(w, http.StatusBadRequest, "failed to create setup intent")
		return
	}

	httpjson.Write(w, http.StatusOK, createSetupIntentResp{
		ClientSecret: si.ClientSecret,
		CustomerID:   customerID,
	})
}

type setDefaultPMReq struct {
	DojoID          string `json:"dojoId"`
	PaymentMethodID string `json:"paymentMethodId"`
}

// SetDefaultPaymentMethod: Customer の default_payment_method を更新
func (h *Stripe) SetDefaultPaymentMethod(w http.ResponseWriter, r *http.Request) {
	if h.cfg.StripeSecretKey == "" {
		httpjson.Error(w, http.StatusNotImplemented, "STRIPE_SECRET_KEY not set")
		return
	}
	stripe.Key = h.cfg.StripeSecretKey

	var req setDefaultPMReq
	if err := httpjson.Read(r, &req); err != nil || req.DojoID == "" || req.PaymentMethodID == "" {
		httpjson.Error(w, http.StatusBadRequest, "dojoId, paymentMethodId required")
		return
	}

	ctx := r.Context()
	dojoRef := h.clients.Firestore.Collection("dojos").Doc(req.DojoID)

	var customerID string
	if snap, err := dojoRef.Get(ctx); err == nil && snap.Exists() {
		if v, ok := snap.Data()["stripeCustomerId"].(string); ok {
			customerID = v
		}
	}
	if customerID == "" {
		httpjson.Error(w, http.StatusBadRequest, "stripe customer not found for dojo")
		return
	}

	_, err := customer.Update(customerID, &stripe.CustomerParams{
		InvoiceSettings: &stripe.CustomerInvoiceSettingsParams{
			DefaultPaymentMethod: stripe.String(req.PaymentMethodID),
		},
	})
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to set default payment method")
		return
	}

	httpjson.Write(w, http.StatusOK, map[string]any{"ok": true})
}
