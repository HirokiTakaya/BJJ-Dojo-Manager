package handlers

import (
	"context"
)

type contextKey string

const (
	authUIDKey   contextKey = "authUID"
	authTokenKey contextKey = "authToken"
)

// SetAuthUID sets the authenticated user's UID in context
func SetAuthUID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, authUIDKey, uid)
}

// GetAuthUID retrieves the authenticated user's UID from context
func GetAuthUID(ctx context.Context) (string, bool) {
	uid, ok := ctx.Value(authUIDKey).(string)
	return uid, ok
}

// SetAuthToken sets the auth token in context
func SetAuthToken(ctx context.Context, token interface{}) context.Context {
	return context.WithValue(ctx, authTokenKey, token)
}

// GetAuthToken retrieves the auth token from context
func GetAuthToken(ctx context.Context) (interface{}, bool) {
	token := ctx.Value(authTokenKey)
	return token, token != nil
}