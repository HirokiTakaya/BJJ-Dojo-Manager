package middleware

import (
	"context"
	"net/http"
	"strings"

	"firebase.google.com/go/v4/auth"
)

type ctxKey string

const authUserKey ctxKey = "authUser"

type AuthUser struct {
	UID    string
	Email  string
	Claims map[string]any
}

func WithAuth(authClient *auth.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if h == "" || !strings.HasPrefix(strings.ToLower(h), "bearer ") {
				http.Error(w, "missing Authorization: Bearer <token>", http.StatusUnauthorized)
				return
			}
			idToken := strings.TrimSpace(h[len("Bearer "):])

			tok, err := authClient.VerifyIDToken(r.Context(), idToken)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			au := &AuthUser{
				UID:    tok.UID,
				Claims: tok.Claims,
			}
			if v, ok := tok.Claims["email"].(string); ok {
				au.Email = v
			}

			ctx := context.WithValue(r.Context(), authUserKey, au)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetAuthUser(ctx context.Context) (*AuthUser, bool) {
	v := ctx.Value(authUserKey)
	if v == nil {
		return nil, false
	}
	au, ok := v.(*AuthUser)
	return au, ok
}

// IsAdmin checks if the user has admin role in their claims
func IsAdmin(claims map[string]any) bool {
	if claims == nil {
		return false
	}
	// Check admin flag
	if admin, ok := claims["admin"].(bool); ok && admin {
		return true
	}
	// Check role field
	if role, ok := claims["role"].(string); ok {
		if role == "admin" {
			return true
		}
	}
	// Check roles map
	if roles, ok := claims["roles"].(map[string]interface{}); ok {
		if val, hasAdmin := roles["admin"]; hasAdmin {
			if b, ok := val.(bool); ok && b {
				return true
			}
		}
	}
	// Check roles array
	if roles, ok := claims["roles"].([]interface{}); ok {
		for _, r := range roles {
			if str, ok := r.(string); ok && str == "admin" {
				return true
			}
		}
	}
	return false
}

// IsStaff checks if the user has staff, staff_member, admin, owner, or coach role
func IsStaff(claims map[string]any) bool {
	if claims == nil {
		return false
	}

	staffRoles := []string{"admin", "staff", "staff_member", "owner", "coach"}

	// Check role field
	if role, ok := claims["role"].(string); ok {
		for _, r := range staffRoles {
			if role == r {
				return true
			}
		}
	}

	// Check roleUi field
	if roleUi, ok := claims["roleUi"].(string); ok && roleUi == "staff" {
		return true
	}

	// Check accountType field
	if accountType, ok := claims["accountType"].(string); ok {
		for _, r := range staffRoles {
			if accountType == r {
				return true
			}
		}
	}

	// Check userType field
	if userType, ok := claims["userType"].(string); ok {
		for _, r := range staffRoles {
			if userType == r {
				return true
			}
		}
	}

	// Check individual flags
	if staff, ok := claims["staff"].(bool); ok && staff {
		return true
	}
	if owner, ok := claims["owner"].(bool); ok && owner {
		return true
	}
	if coach, ok := claims["coach"].(bool); ok && coach {
		return true
	}
	if admin, ok := claims["admin"].(bool); ok && admin {
		return true
	}

	// Check roles map
	if roles, ok := claims["roles"].(map[string]interface{}); ok {
		for _, r := range staffRoles {
			if val, has := roles[r]; has {
				if b, ok := val.(bool); ok && b {
					return true
				}
			}
		}
	}

	// Check roles array
	if roles, ok := claims["roles"].([]interface{}); ok {
		for _, role := range roles {
			if str, ok := role.(string); ok {
				for _, r := range staffRoles {
					if str == r {
						return true
					}
				}
			}
		}
	}

	return false
}

// IsOwner checks if the user has owner role
func IsOwner(claims map[string]any) bool {
	if claims == nil {
		return false
	}
	if role, ok := claims["role"].(string); ok {
		return role == "owner" || role == "admin"
	}
	return false
}