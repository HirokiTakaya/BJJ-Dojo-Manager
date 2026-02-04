package session

import (
	"context"
	"fmt"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Repo struct {
	fs *firestore.Client
}

func NewRepo(fs *firestore.Client) *Repo {
	return &Repo{fs: fs}
}

// timetableClassesCollection returns the timetableClasses subcollection for a dojo
// This is the template collection for recurring classes (used by frontend timetable UI)
func (r *Repo) timetableClassesCollection(dojoID string) *firestore.CollectionRef {
	return r.fs.Collection("dojos").Doc(dojoID).Collection("timetableClasses")
}

// Create creates a new session (timetable class template)
func (r *Repo) Create(ctx context.Context, dojoID string, s Session) (*Session, error) {
	ref := r.timetableClassesCollection(dojoID).NewDoc()
	s.ID = ref.ID
	s.DojoID = dojoID

	_, err := ref.Set(ctx, s)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &s, nil
}

// Get retrieves a session by ID
func (r *Repo) Get(ctx context.Context, dojoID, sessionID string) (*Session, error) {
	doc, err := r.timetableClassesCollection(dojoID).Doc(sessionID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: session not found", ErrNotFound)
	}

	var s Session
	if err := doc.DataTo(&s); err != nil {
		return nil, fmt.Errorf("failed to parse session: %w", err)
	}
	s.ID = doc.Ref.ID
	s.DojoID = dojoID

	return &s, nil
}

// Update updates a session
func (r *Repo) Update(ctx context.Context, dojoID, sessionID string, updates map[string]interface{}) (*Session, error) {
	ref := r.timetableClassesCollection(dojoID).Doc(sessionID)

	_, err := ref.Set(ctx, updates, firestore.MergeAll)
	if err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}

	return r.Get(ctx, dojoID, sessionID)
}

// Delete deletes a session
func (r *Repo) Delete(ctx context.Context, dojoID, sessionID string) error {
	_, err := r.timetableClassesCollection(dojoID).Doc(sessionID).Delete(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

// List lists sessions (timetable classes) for a dojo
func (r *Repo) List(ctx context.Context, dojoID string, input ListSessionsInput) ([]Session, error) {
	q := r.timetableClassesCollection(dojoID).Query

	if input.DayOfWeek != nil {
		q = q.Where("dayOfWeek", "==", *input.DayOfWeek)
	}

	if input.ActiveOnly {
		q = q.Where("isActive", "==", true)
	}

	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q = q.Limit(int(limit))

	// Order by dayOfWeek, then startTime
	q = q.OrderBy("dayOfWeek", firestore.Asc).OrderBy("startTime", firestore.Asc)

	iter := q.Documents(ctx)
	defer iter.Stop()

	var sessions []Session
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate sessions: %w", err)
		}

		var s Session
		if err := doc.DataTo(&s); err != nil {
			continue
		}
		s.ID = doc.Ref.ID
		s.DojoID = dojoID
		sessions = append(sessions, s)
	}

	if sessions == nil {
		sessions = []Session{}
	}

	return sessions, nil
}

// ListByDay lists sessions for a specific day
func (r *Repo) ListByDay(ctx context.Context, dojoID string, dayOfWeek int) ([]Session, error) {
	return r.List(ctx, dojoID, ListSessionsInput{
		DayOfWeek:  &dayOfWeek,
		ActiveOnly: true,
	})
}