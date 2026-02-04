package handlers

import (
	"net/http"
	"time"

	"dojo-manager/backend/internal/authctx"
	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/firebase"
	"dojo-manager/backend/internal/httpjson"
	"dojo-manager/backend/internal/middleware"
	"dojo-manager/backend/internal/models"
	"dojo-manager/backend/internal/utils"

	"cloud.google.com/go/firestore"
	"github.com/go-chi/chi/v5"
	"google.golang.org/api/iterator"
)

type Dojos struct {
	cfg     config.Config
	clients *firebase.Clients
}

func NewDojos(cfg config.Config, clients *firebase.Clients) *Dojos {
	return &Dojos{cfg: cfg, clients: clients}
}

type createDojoReq struct {
	Name     string `json:"name"`
	Address  string `json:"address,omitempty"`
	City     string `json:"city,omitempty"`
	Country  string `json:"country,omitempty"`
	IsPublic *bool  `json:"isPublic,omitempty"`
}

func (h *Dojos) CreateDojo(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}

	var req createDojoReq
	if err := httpjson.Read(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" || len(req.Name) > 120 {
		httpjson.Error(w, http.StatusBadRequest, "name is required (<=120 chars)")
		return
	}

	slug := utils.Slugify(req.Name)
	if slug == "" {
		httpjson.Error(w, http.StatusBadRequest, "invalid name")
		return
	}

	ctx := r.Context()
	now := time.Now()

	// Ensure unique slug via a "dojoSlugs" lock doc.
	slugRef := h.clients.Firestore.Collection("dojoSlugs").Doc(slug)
	if snap, err := slugRef.Get(ctx); err == nil && snap.Exists() {
		httpjson.Error(w, http.StatusConflict, "dojo name already taken")
		return
	}

	dojoRef := h.clients.Firestore.Collection("dojos").Doc(slug) // use slug as ID
	dojo := models.Dojo{
		Name:         req.Name,
		Slug:         slug,
		Address:      req.Address,
		City:         req.City,
		Country:      req.Country,
		CreatedBy:    uid,
		CreatedAt:    now,
		UpdatedAt:    now,
		SearchTokens: utils.SearchTokens(req.Name, req.City, req.Country),
		IsPublic:     req.IsPublic == nil || *req.IsPublic,
	}

	batch := h.clients.Firestore.Batch()
	batch.Set(slugRef, map[string]interface{}{
		"dojoId":    slug,
		"createdAt": now,
		"createdBy": uid,
	})
	batch.Set(dojoRef, dojo)

	// Creator becomes owner+active member
	memberRef := dojoRef.Collection("members").Doc(uid)
	batch.Set(memberRef, models.DojoMember{
		UID:        uid,
		Role:       "owner",
		Status:     "active",
		JoinedAt:   now,
		ApprovedBy: uid,
		ApprovedAt: now,
	})

	if _, err := batch.Commit(ctx); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create dojo")
		return
	}

	httpjson.Write(w, http.StatusCreated, map[string]interface{}{
		"dojoId": slug,
		"dojo":   dojo,
	})
}

func (h *Dojos) GetDojo(w http.ResponseWriter, r *http.Request) {
	dojoId := chi.URLParam(r, "dojoId")
	if dojoId == "" {
		httpjson.Error(w, http.StatusBadRequest, "missing dojoId")
		return
	}
	snap, err := h.clients.Firestore.Collection("dojos").Doc(dojoId).Get(r.Context())
	if err != nil || !snap.Exists() {
		httpjson.Error(w, http.StatusNotFound, "dojo not found")
		return
	}
	var dojo models.Dojo
	if err := snap.DataTo(&dojo); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to parse dojo")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"dojoId": dojoId, "dojo": dojo})
}

func (h *Dojos) SearchDojos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": []interface{}{}})
		return
	}
	token := utils.NormalizeToken(q)
	if token == "" {
		httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": []interface{}{}})
		return
	}

	ctx := r.Context()
	it := h.clients.Firestore.Collection("dojos").
		Where("searchTokens", "array-contains", token).
		Limit(30).
		Documents(ctx)

	items := make([]map[string]interface{}, 0, 30)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "search failed")
			return
		}
		var dojo models.Dojo
		_ = snap.DataTo(&dojo)
		items = append(items, map[string]interface{}{"dojoId": snap.Ref.ID, "dojo": dojo})
	}

	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}

type joinReq struct {
	Message string `json:"message,omitempty"`
}

func (h *Dojos) RequestJoin(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	dojoId := chi.URLParam(r, "dojoId")
	if dojoId == "" {
		httpjson.Error(w, http.StatusBadRequest, "missing dojoId")
		return
	}

	var req joinReq
	_ = httpjson.Read(r, &req)

	memberRef := h.clients.Firestore.Collection("dojos").Doc(dojoId).Collection("members").Doc(uid)
	now := time.Now()

	_, err := memberRef.Set(r.Context(), map[string]interface{}{
		"uid":      uid,
		"role":     "student",
		"status":   "pending",
		"joinedAt": now,
		"message":  utils.TrimMax(req.Message, 500),
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to request join")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"status": "pending"})
}

type approveReq struct {
	UserID string `json:"userId"`
}

func (h *Dojos) Approve(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}

	dojoId := chi.URLParam(r, "dojoId")
	var req approveReq
	if err := httpjson.Read(r, &req); err != nil || req.UserID == "" {
		httpjson.Error(w, http.StatusBadRequest, "userId required")
		return
	}

	memberRef := h.clients.Firestore.Collection("dojos").Doc(dojoId).Collection("members").Doc(req.UserID)
	now := time.Now()
	_, err := memberRef.Set(r.Context(), map[string]interface{}{
		"status":     "active",
		"approvedBy": uid,
		"approvedAt": now,
	}, firestore.MergeAll)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to approve")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"status": "active"})
}

func (h *Dojos) ListMembers(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsStaff(claims) {
		httpjson.Error(w, http.StatusForbidden, "staff role required")
		return
	}
	dojoId := chi.URLParam(r, "dojoId")

	ctx := r.Context()
	it := h.clients.Firestore.Collection("dojos").Doc(dojoId).Collection("members").Limit(200).Documents(ctx)
	items := make([]map[string]interface{}, 0, 200)
	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "failed to list members")
			return
		}
		items = append(items, map[string]interface{}{"uid": snap.Ref.ID, "data": snap.Data()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": items})
}
