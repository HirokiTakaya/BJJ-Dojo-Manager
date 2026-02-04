package firebase

import (
	"context"
	"fmt"
	"os"

	"dojo-manager/backend/internal/config"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/option"
)

// Clients bundles Firebase + GCP clients used by handlers.
type Clients struct {
	App       *firebase.App
	Auth      *auth.Client
	Firestore *firestore.Client
	Storage   *storage.Client
	Messaging *messaging.Client

	ProjectID string
	Bucket    string
}

// Client is an alias for Clients (for backward compatibility with http/handlers)
type Client = Clients

func NewClients(ctx context.Context, cfg config.Config) (*Clients, error) {
	if cfg.ProjectID == "" {
		return nil, fmt.Errorf("missing FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT")
	}

	var opts []option.ClientOption
	// In Cloud Run / GCP, Application Default Credentials are used automatically.
	// Locally, set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file.
	if cred := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"); cred != "" {
		opts = append(opts, option.WithCredentialsFile(cred))
	}

	app, err := firebase.NewApp(ctx, &firebase.Config{
		ProjectID:     cfg.ProjectID,
		StorageBucket: cfg.StorageBucket,
	}, opts...)
	if err != nil {
		return nil, err
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}

	fs, err := firestore.NewClient(ctx, cfg.ProjectID, opts...)
	if err != nil {
		return nil, err
	}

	st, err := storage.NewClient(ctx, opts...)
	if err != nil {
		return nil, err
	}

	msg, _ := app.Messaging(ctx) // optional

	return &Clients{
		App:       app,
		Auth:      authClient,
		Firestore: fs,
		Storage:   st,
		Messaging: msg,
		ProjectID: cfg.ProjectID,
		Bucket:    cfg.StorageBucket,
	}, nil
}

// NewClient is an alias for NewClients (for backward compatibility)
func NewClient(ctx context.Context, cfg config.Config) (*Client, error) {
	return NewClients(ctx, cfg)
}