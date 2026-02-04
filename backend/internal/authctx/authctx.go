package authctx

import (
	"context"
)

type ctxKey string

const (
	uidKey    ctxKey = "uid"
	claimsKey ctxKey = "claims"
)

func WithUID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, uidKey, uid)
}

func UID(ctx context.Context) (string, bool) {
	v := ctx.Value(uidKey)
	uid, ok := v.(string)
	return uid, ok && uid != ""
}

func WithClaims(ctx context.Context, claims map[string]interface{}) context.Context {
	return context.WithValue(ctx, claimsKey, claims)
}

func Claims(ctx context.Context) (map[string]interface{}, bool) {
	v := ctx.Value(claimsKey)
	claims, ok := v.(map[string]interface{})
	return claims, ok
}
