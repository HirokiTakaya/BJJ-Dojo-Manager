package firebase

import (
	"context"
	"os"

	"dojo-manager/backend/internal/config"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

func NewApp(ctx context.Context, cfg config.Config) (*firebase.App, error) {
	// Prefer GOOGLE_APPLICATION_CREDENTIALS (service account json file path)
	// Or FIREBASE_SERVICE_ACCOUNT_JSON (raw json content)
	opts := []option.ClientOption{}

	if json := getenv("FIREBASE_SERVICE_ACCOUNT_JSON", ""); json != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(json)))
	}

	// If ProjectID is set, pass it (useful when running locally)
	appCfg := &firebase.Config{}
	if cfg.ProjectID != "" {
		appCfg.ProjectID = cfg.ProjectID
	}

	if len(opts) > 0 {
		return firebase.NewApp(ctx, appCfg, opts...)
	}
	return firebase.NewApp(ctx, appCfg)
}

func NewAuthClient(ctx context.Context, app *firebase.App) (*auth.Client, error) {
	return app.Auth(ctx)
}

// NewFirestoreClient creates a new Firestore client from the Firebase app
func NewFirestoreClient(ctx context.Context, app *firebase.App) (*firestore.Client, error) {
	return app.Firestore(ctx)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}