package firebase

import (
	"context"
	"os"

	firebase "firebase.google.com/go/v4"
	"cloud.google.com/go/firestore"
)

type Firestore struct {
	Client *firestore.Client
}

func NewFirestore(ctx context.Context, app *firebase.App) (*Firestore, error) {
	c, err := app.Firestore(ctx)
	if err != nil {
		return nil, err
	}
	return &Firestore{Client: c}, nil
}

func (f *Firestore) Close() {
	if f == nil || f.Client == nil {
		return
	}
	_ = f.Client.Close()
}

// === std env helper (used by firebase.go) ===

func getEnvStd(key string) string { return os.Getenv(key) }
