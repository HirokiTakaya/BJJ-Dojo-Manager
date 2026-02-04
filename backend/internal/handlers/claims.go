package handlers

import (
	"net/http"
	"time"

	"dojo-manager/backend/internal/authctx"
	"dojo-manager/backend/internal/httpjson"
	"dojo-manager/backend/internal/middleware"

	"google.golang.org/api/iterator"
)

// migrateAllUserClaims: admin-only bulk claim sync from Firestore users collection.
func (h *Legacy) MigrateAllUserClaims(w http.ResponseWriter, r *http.Request) {
	claims, _ := authctx.Claims(r.Context())
	if !middleware.IsAdmin(claims) {
		httpjson.Error(w, http.StatusForbidden, "admin role required")
		return
	}

	var req struct {
		Limit int `json:"limit,omitempty"`
	}
	_ = httpjson.Read(r, &req)
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	ctx := r.Context()
	it := h.clients.Firestore.Collection("users").Limit(limit).Documents(ctx)
	updated := 0
	errors := 0

	for {
		snap, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			errors++
			break
		}
		data := snap.Data()
		role, _ := data["role"].(string)
		if role == "" {
			continue
		}
		c := map[string]interface{}{
			"role":            role,
			"roles":           map[string]bool{role: true},
			"claimsUpdatedAt": time.Now().Unix(),
		}
		if err := h.clients.Auth.SetCustomUserClaims(ctx, snap.Ref.ID, c); err != nil {
			errors++
			continue
		}
		updated++
	}

	httpjson.Write(w, http.StatusOK, map[string]interface{}{"updated": updated, "errors": errors})
}

// syncUserClaims: sync current user's claims based on their users/{uid} doc.
func (h *Legacy) SyncUserClaims(w http.ResponseWriter, r *http.Request) {
	uid, _ := authctx.UID(r.Context())

	snap, err := h.clients.Firestore.Collection("users").Doc(uid).Get(r.Context())
	if err != nil || !snap.Exists() {
		httpjson.Error(w, http.StatusNotFound, "user profile not found")
		return
	}

	data := snap.Data()
	role, _ := data["role"].(string)
	if role == "" {
		role = "student"
	}

	c := map[string]interface{}{
		"role":            role,
		"roles":           map[string]bool{role: true},
		"claimsUpdatedAt": time.Now().Unix(),
	}

	if err := h.clients.Auth.SetCustomUserClaims(r.Context(), uid, c); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to set claims")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"ok": true, "role": role})
}
