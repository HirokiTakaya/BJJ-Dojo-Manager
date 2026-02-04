package user

import (
	"context"
	"time"

	"cloud.google.com/go/firestore"
)

type Repo struct {
	fs *firestore.Client
}

func NewRepo(fs *firestore.Client) *Repo {
	return &Repo{fs: fs}
}

func (r *Repo) Get(ctx context.Context, uid string) (*Profile, error) {
	doc, err := r.fs.Collection("users").Doc(uid).Get(ctx)
	if err != nil {
		return nil, err
	}
	var p Profile
	if err := doc.DataTo(&p); err != nil {
		return nil, err
	}
	if p.UID == "" {
		p.UID = uid
	}
	return &p, nil
}

func (r *Repo) UpsertMinimal(ctx context.Context, uid, email string) error {
	ref := r.fs.Collection("users").Doc(uid)
	_, err := ref.Set(ctx, map[string]any{
		"uid":       uid,
		"email":     email,
		"updatedAt": time.Now().UTC(),
	}, firestore.MergeAll)
	return err
}
