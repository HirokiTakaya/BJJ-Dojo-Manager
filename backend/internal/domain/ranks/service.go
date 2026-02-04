package ranks

import (
	"context"
	"fmt"

	"dojo-manager/backend/internal/domain/dojo"
)

type Service struct {
	repo     *Repo
	dojoRepo *dojo.Repo
}

func NewService(repo *Repo, dojoRepo *dojo.Repo) *Service {
	return &Service{repo: repo, dojoRepo: dojoRepo}
}

// UpdateMemberRank updates a member's belt rank
func (s *Service) UpdateMemberRank(ctx context.Context, staffUID string, input UpdateMemberRankInput) (map[string]interface{}, error) {
	input.Trim()

	if input.DojoID == "" || input.MemberUID == "" || input.BeltRank == "" {
		return nil, fmt.Errorf("%w: dojoId, memberUid, beltRank are required", ErrBadRequest)
	}

	// Check staff permission
	isStaff, err := s.dojoRepo.IsStaff(ctx, input.DojoID, staffUID)
	if err != nil {
		return nil, fmt.Errorf("failed to check staff status: %w", err)
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: staff permission required", ErrUnauthorized)
	}

	// Get current rank
	previousBelt, previousStripes, err := s.repo.GetMemberRank(ctx, input.DojoID, input.MemberUID)
	if err != nil {
		return nil, err
	}

	newStripes := 0
	if input.Stripes != nil {
		newStripes = *input.Stripes
		if newStripes < 0 {
			newStripes = 0
		}
		if newStripes > 4 {
			newStripes = 4
		}
	}

	err = s.repo.UpdateMemberRank(ctx, input.DojoID, input.MemberUID, staffUID, input.BeltRank, newStripes, input.Notes)
	if err != nil {
		return nil, fmt.Errorf("failed to update rank: %w", err)
	}

	return map[string]interface{}{
		"success":         true,
		"previousBelt":    previousBelt,
		"previousStripes": previousStripes,
		"newBelt":         input.BeltRank,
		"newStripes":      newStripes,
	}, nil
}

// AddStripe adds a stripe to a member
func (s *Service) AddStripe(ctx context.Context, staffUID string, input AddStripeInput) (map[string]interface{}, error) {
	input.Trim()

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

	previousStripes, newStripes, err := s.repo.AddStripe(ctx, input.DojoID, input.MemberUID, staffUID, input.Notes)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"success":         true,
		"previousStripes": previousStripes,
		"newStripes":      newStripes,
	}, nil
}

// GetRankHistory gets rank history for a member
func (s *Service) GetRankHistory(ctx context.Context, dojoID, memberUID string) ([]RankHistory, error) {
	if dojoID == "" || memberUID == "" {
		return nil, fmt.Errorf("%w: dojoId and memberUid are required", ErrBadRequest)
	}

	return s.repo.GetRankHistory(ctx, dojoID, memberUID, 50)
}

// GetBeltDistribution gets belt distribution for a dojo
func (s *Service) GetBeltDistribution(ctx context.Context, dojoID string) (*BeltDistributionResult, error) {
	if dojoID == "" {
		return nil, fmt.Errorf("%w: dojoId is required", ErrBadRequest)
	}

	return s.repo.GetBeltDistribution(ctx, dojoID)
}
