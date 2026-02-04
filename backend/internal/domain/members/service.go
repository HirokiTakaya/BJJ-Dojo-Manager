package members

import (
	"context"
	"fmt"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"

	"dojo-manager/backend/internal/domain/dojo"
	stripedom "dojo-manager/backend/internal/domain/stripe"
)

type Service struct {
	client    *firestore.Client
	dojoRepo  *dojo.Repo
	stripeSvc *stripedom.Service // plan limit checks
}

func NewService(client *firestore.Client, dojoRepo *dojo.Repo) *Service {
	return &Service{client: client, dojoRepo: dojoRepo}
}

func (s *Service) SetStripeService(stripeSvc *stripedom.Service) {
	s.stripeSvc = stripeSvc
}

func (s *Service) membersCol(dojoID string) *firestore.CollectionRef {
	return s.client.Collection("dojos").Doc(dojoID).Collection("members")
}

func isStaffRole(role string) bool {
	return role == RoleStaff || role == RoleCoach || role == RoleOwner
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// GetMember gets a single member
func (s *Service) GetMember(ctx context.Context, dojoID, memberUID string) (*MemberWithUser, error) {
	dojoID = strings.TrimSpace(dojoID)
	memberUID = strings.TrimSpace(memberUID)

	if dojoID == "" || memberUID == "" {
		return nil, fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	memberDoc, err := s.membersCol(dojoID).Doc(memberUID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: member not found", ErrNotFound)
	}

	var member Member
	if err := memberDoc.DataTo(&member); err != nil {
		return nil, fmt.Errorf("failed to decode member: %w", err)
	}
	member.UID = memberDoc.Ref.ID

	// Get user info
	userDoc, err := s.client.Collection("users").Doc(memberUID).Get(ctx)
	var user MemberUser
	if err == nil && userDoc.Exists() {
		userData := userDoc.Data()
		user.DisplayName, _ = userData["displayName"].(string)
		user.Email, _ = userData["email"].(string)
		user.PhotoURL, _ = userData["photoURL"].(string)
	}

	return &MemberWithUser{
		UID:    memberUID,
		Member: member,
		User:   user,
	}, nil
}

// ListMembers lists members of a dojo
func (s *Service) ListMembers(ctx context.Context, input ListMembersInput) ([]MemberWithUser, error) {
	input.DojoID = strings.TrimSpace(input.DojoID)
	input.Status = strings.ToLower(strings.TrimSpace(input.Status))

	if input.DojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	query := s.membersCol(input.DojoID).Query
	if input.Status != "" {
		query = query.Where("status", "==", input.Status)
	}

	limit := input.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	query = query.Limit(limit)

	iter := query.Documents(ctx)
	var results []MemberWithUser

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list members: %w", err)
		}

		var member Member
		if err := doc.DataTo(&member); err != nil {
			continue
		}
		member.UID = doc.Ref.ID

		// Get user info
		userDoc, _ := s.client.Collection("users").Doc(doc.Ref.ID).Get(ctx)
		var user MemberUser
		if userDoc != nil && userDoc.Exists() {
			userData := userDoc.Data()
			user.DisplayName, _ = userData["displayName"].(string)
			user.Email, _ = userData["email"].(string)
			user.PhotoURL, _ = userData["photoURL"].(string)
		}

		results = append(results, MemberWithUser{
			UID:    doc.Ref.ID,
			Member: member,
			User:   user,
		})
	}

	return results, nil
}

// AddMember adds a new member to a dojo (with plan limit check)
func (s *Service) AddMember(ctx context.Context, staffUID string, input AddMemberInput) (*MemberWithUser, error) {
	input.Trim()
	staffUID = strings.TrimSpace(staffUID)

	if input.DojoID == "" || input.MemberUID == "" {
		return nil, fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	// Check staff permission
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// plan limit before adding member
	if s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "member"); err != nil {
			return nil, err
		}
	}

	// Check if member already exists
	existingDoc, err := s.membersCol(input.DojoID).Doc(input.MemberUID).Get(ctx)
	if err == nil && existingDoc != nil && existingDoc.Exists() {
		return nil, fmt.Errorf("%w: member already exists in this dojo", ErrBadRequest)
	}

	now := time.Now().UTC()

	roleInDojo := strings.ToLower(strings.TrimSpace(input.RoleInDojo))
	if roleInDojo == "" {
		roleInDojo = RoleStudent
	}
	if !IsValidRole(roleInDojo) {
		return nil, fmt.Errorf("%w: roleInDojo must be one of: student, coach, staff, owner", ErrBadRequest)
	}

	// staff limit if staff-role
	if isStaffRole(roleInDojo) && s.stripeSvc != nil {
		if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "staff"); err != nil {
			return nil, err
		}
	}

	status := strings.ToLower(strings.TrimSpace(input.Status))
	if status == "" {
		status = StatusActive
	}
	if !IsValidStatus(status) {
		return nil, fmt.Errorf("%w: status must be one of: pending, approved, active, inactive", ErrBadRequest)
	}

	memberData := map[string]interface{}{
		"roleInDojo": roleInDojo,
		"status":     status,
		"joinedAt":   now,
		"createdAt":  now,
		"updatedAt":  now,

		// 既存フィールドは残す（壊さない）
		"addedBy": staffUID,
	}

	// approvedBy/approvedAt は model にあるので、自然に埋める（pending のときは付けない）
	if status == StatusApproved || status == StatusActive {
		memberData["approvedBy"] = staffUID
		memberData["approvedAt"] = now
	}

	// beltRank (optional)
	br := strings.TrimSpace(input.BeltRank)
	if br != "" {
		memberData["beltRank"] = br
	}

	// stripes (optional) - 0は保存しない方針
	if input.Stripes != 0 {
		n := clampInt(input.Stripes, 0, 4)
		if n > 0 {
			memberData["stripes"] = n
		}
	}

	_, err = s.membersCol(input.DojoID).Doc(input.MemberUID).Set(ctx, memberData)
	if err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}

	return s.GetMember(ctx, input.DojoID, input.MemberUID)
}

// UpdateMember updates a member
func (s *Service) UpdateMember(ctx context.Context, staffUID string, input UpdateMemberInput) (*MemberWithUser, error) {
	input.Trim()
	staffUID = strings.TrimSpace(staffUID)

	if input.DojoID == "" || input.MemberUID == "" {
		return nil, fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	// Check staff permission
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// Get existing member (for role-change checks)
	existingDoc, err := s.membersCol(input.DojoID).Doc(input.MemberUID).Get(ctx)
	if err != nil || existingDoc == nil || !existingDoc.Exists() {
		return nil, fmt.Errorf("%w: member not found", ErrNotFound)
	}
	var existing Member
	_ = existingDoc.DataTo(&existing)

	now := time.Now().UTC()

	updates := map[string]interface{}{
		"updatedAt": now,
		"updatedBy": staffUID,
	}

	// role change
	if input.RoleInDojo != nil {
		role := strings.ToLower(strings.TrimSpace(*input.RoleInDojo))
		if role == "" {
			return nil, fmt.Errorf("%w: roleInDojo cannot be empty", ErrBadRequest)
		}
		if !IsValidRole(role) {
			return nil, fmt.Errorf("%w: roleInDojo must be one of: student, coach, staff, owner", ErrBadRequest)
		}

		// promoting to staff-role from non-staff-role => check staff plan limit
		if isStaffRole(role) && !isStaffRole(existing.RoleInDojo) && s.stripeSvc != nil {
			if err := s.stripeSvc.CheckPlanLimit(ctx, input.DojoID, "staff"); err != nil {
				return nil, err
			}
		}

		updates["roleInDojo"] = role
	}

	// status change
	if input.Status != nil {
		st := strings.ToLower(strings.TrimSpace(*input.Status))
		if st == "" {
			return nil, fmt.Errorf("%w: status cannot be empty", ErrBadRequest)
		}
		if !IsValidStatus(st) {
			return nil, fmt.Errorf("%w: status must be one of: pending, approved, active, inactive", ErrBadRequest)
		}
		updates["status"] = st
	}

	// beltRank change ("" => delete)
	if input.BeltRank != nil {
		br := strings.TrimSpace(*input.BeltRank)
		if br == "" {
			updates["beltRank"] = firestore.Delete
		} else {
			updates["beltRank"] = br
		}
	}

	// stripes change (clamp 0..4) - 0は消す方針に合わせる
	if input.Stripes != nil {
		n := clampInt(*input.Stripes, 0, 4)
		if n == 0 {
			updates["stripes"] = firestore.Delete
		} else {
			updates["stripes"] = n
		}
	}

	_, err = s.membersCol(input.DojoID).Doc(input.MemberUID).Set(ctx, updates, firestore.MergeAll)
	if err != nil {
		return nil, fmt.Errorf("failed to update member: %w", err)
	}

	return s.GetMember(ctx, input.DojoID, input.MemberUID)
}

// DeleteMember deletes a member from a dojo
func (s *Service) DeleteMember(ctx context.Context, staffUID string, dojoID string, memberUID string) error {
	staffUID = strings.TrimSpace(staffUID)
	dojoID = strings.TrimSpace(dojoID)
	memberUID = strings.TrimSpace(memberUID)

	if dojoID == "" || memberUID == "" {
		return fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	// staff permission required
	isStaff, err := s.dojoRepo.IsStaff(ctx, dojoID, staffUID)
	if err != nil {
		return fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	_, err = s.membersCol(dojoID).Doc(memberUID).Delete(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete member: %w", err)
	}
	return nil
}
