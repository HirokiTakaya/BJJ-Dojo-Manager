package profile

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"firebase.google.com/go/v4/auth"
)

type Service struct {
	client     *firestore.Client
	authClient *auth.Client
}

func NewService(client *firestore.Client, authClient *auth.Client) *Service {
	return &Service{client: client, authClient: authClient}
}

// GetProfile gets a user's profile
func (s *Service) GetProfile(ctx context.Context, uid string) (*UserProfile, error) {
	if uid == "" {
		return nil, fmt.Errorf("%w: uid is required", ErrBadRequest)
	}

	doc, err := s.client.Collection("users").Doc(uid).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: user not found", ErrNotFound)
	}

	var profile UserProfile
	if err := doc.DataTo(&profile); err != nil {
		return nil, fmt.Errorf("failed to decode profile: %w", err)
	}
	profile.UID = uid

	return &profile, nil
}

// UpdateProfile updates a user's profile
func (s *Service) UpdateProfile(ctx context.Context, uid string, input UpdateProfileInput) error {
	if uid == "" {
		return fmt.Errorf("%w: uid is required", ErrBadRequest)
	}

	input.Trim()

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"updatedAt": now,
	}

	// Check emergency contact update frequency
	if input.EmergencyContact != nil {
		doc, err := s.client.Collection("users").Doc(uid).Get(ctx)
		if err == nil && doc.Exists() {
			userData := doc.Data()
			if lastUpdate, ok := userData["emergencyContactUpdatedAt"].(time.Time); ok {
				diffDays := now.Sub(lastUpdate).Hours() / 24
				if diffDays < 30 {
					return fmt.Errorf("%w: emergency contact can only be updated once every 30 days", ErrTooManyUpdates)
				}
			}
		}
		updates["emergencyContact"] = input.EmergencyContact
		updates["emergencyContactUpdatedAt"] = now
	}

	if input.DisplayName != nil {
		updates["displayName"] = *input.DisplayName
	}
	if input.PhotoURL != nil {
		updates["photoURL"] = *input.PhotoURL
	}
	if input.Language != nil {
		updates["language"] = *input.Language
	}

	// Update Firestore
	_, err := s.client.Collection("users").Doc(uid).Set(ctx, updates, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("failed to update profile: %w", err)
	}

	// Update Firebase Auth if needed
	if input.DisplayName != nil || input.PhotoURL != nil {
		authUpdate := &auth.UserToUpdate{}
		if input.DisplayName != nil {
			authUpdate.DisplayName(*input.DisplayName)
		}
		if input.PhotoURL != nil {
			authUpdate.PhotoURL(*input.PhotoURL)
		}
		if _, err := s.authClient.UpdateUser(ctx, uid, authUpdate); err != nil {
			// Log but don't fail
			fmt.Printf("failed to update auth user: %v\n", err)
		}
	}

	return nil
}

// DeactivateUser deactivates a user (Admin only)
func (s *Service) DeactivateUser(ctx context.Context, callerUID, targetUID string) error {
	if targetUID == "" {
		return fmt.Errorf("%w: userId is required", ErrBadRequest)
	}

	if callerUID == targetUID {
		return ErrCannotDeactivateSelf
	}

	// Disable in Firebase Auth
	authUpdate := &auth.UserToUpdate{}
	authUpdate.Disabled(true)
	if _, err := s.authClient.UpdateUser(ctx, targetUID, authUpdate); err != nil {
		return fmt.Errorf("failed to disable user: %w", err)
	}

	// Update Firestore
	now := time.Now().UTC()
	_, err := s.client.Collection("users").Doc(targetUID).Set(ctx, map[string]interface{}{
		"isActive":      false,
		"deactivatedAt": now,
		"deactivatedBy": callerUID,
		"updatedAt":     now,
	}, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

// ReactivateUser reactivates a user (Admin only)
func (s *Service) ReactivateUser(ctx context.Context, targetUID string) error {
	if targetUID == "" {
		return fmt.Errorf("%w: userId is required", ErrBadRequest)
	}

	// Enable in Firebase Auth
	authUpdate := &auth.UserToUpdate{}
	authUpdate.Disabled(false)
	if _, err := s.authClient.UpdateUser(ctx, targetUID, authUpdate); err != nil {
		return fmt.Errorf("failed to enable user: %w", err)
	}

	// Update Firestore
	now := time.Now().UTC()
	_, err := s.client.Collection("users").Doc(targetUID).Set(ctx, map[string]interface{}{
		"isActive":      true,
		"reactivatedAt": now,
		"updatedAt":     now,
	}, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}
