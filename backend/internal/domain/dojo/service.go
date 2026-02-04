package dojo

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"dojo-manager/backend/internal/domain/user"
)

type Service struct {
	repo     *Repo
	userRepo *user.Repo
}

func NewService(repo *Repo, userRepo *user.Repo) *Service {
	return &Service{repo: repo, userRepo: userRepo}
}

func (s *Service) CreateDojo(ctx context.Context, staffUid string, in CreateDojoInput) (*Dojo, error) {
	if in.Name == "" {
		return nil, fmt.Errorf("%w: name is required", ErrBadRequest)
	}

	// staff判定：users/{uid} の role/roles を見てOKなら作成
	ok, err := s.isStaffUser(ctx, staffUid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("%w: only staff can create dojo", ErrUnauthorized)
	}

	now := time.Now().UTC()
	slug := in.Slug
	if slug == "" {
		slug = slugify(in.Name)
	}

	d := Dojo{
		Name:      in.Name,
		NameLower: strings.ToLower(in.Name),
		Slug:      slug,
		City:      in.City,
		Country:   in.Country,
		CreatedBy: staffUid,
		StaffUids: []string{staffUid},
		CreatedAt: now,
		UpdatedAt: now,
	}

	out, err := s.repo.CreateDojo(ctx, d)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) SearchDojos(ctx context.Context, q string, limit int64) ([]Dojo, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.repo.SearchDojosByNamePrefix(ctx, q, limit)
}

func (s *Service) CreateJoinRequest(ctx context.Context, studentUid, dojoId string, in CreateJoinRequestInput) (*JoinRequest, error) {
	if dojoId == "" {
		return nil, fmt.Errorf("%w: dojoId required", ErrBadRequest)
	}
	full := strings.TrimSpace(in.FirstName + " " + in.LastName)
	if full == "" {
		return nil, fmt.Errorf("%w: name required", ErrBadRequest)
	}

	// dojo存在チェック
	_, err := s.repo.GetDojo(ctx, dojoId)
	if err != nil {
		return nil, fmt.Errorf("%w: dojo not found", ErrNotFound)
	}

	now := time.Now().UTC()
	jr := JoinRequest{
		UID:       studentUid,
		DojoID:    dojoId,
		FullName:  full,
		Belt:      in.Belt,
		Status:    "pending",
		CreatedAt: now,
		UpdatedAt: now,
	}

	return s.repo.PutJoinRequest(ctx, dojoId, studentUid, jr)
}

func (s *Service) ApproveJoinRequest(ctx context.Context, staffUid, dojoId, studentUid string) (map[string]any, error) {
	if dojoId == "" || studentUid == "" {
		return nil, fmt.Errorf("%w: dojoId and studentUid required", ErrBadRequest)
	}

	isStaff, err := s.repo.IsStaff(ctx, dojoId, staffUid)
	if err != nil {
		return nil, err
	}
	if !isStaff {
		return nil, fmt.Errorf("%w: only dojo staff can approve", ErrUnauthorized)
	}

	jr, err := s.repo.GetJoinRequest(ctx, dojoId, studentUid)
	if err != nil {
		return nil, fmt.Errorf("%w: join request not found", ErrNotFound)
	}
	if jr.Status == "approved" {
		return map[string]any{"ok": true, "status": "already_approved"}, nil
	}

	now := time.Now().UTC()
	jr.Status = "approved"
	jr.UpdatedAt = now
	_, err = s.repo.PutJoinRequest(ctx, dojoId, studentUid, *jr)
	if err != nil {
		return nil, err
	}

	m := Membership{
		UID:       studentUid,
		Role:      "student",
		Belt:      jr.Belt,
		FullName:  jr.FullName,
		JoinedAt:  now,
		UpdatedAt: now,
	}
	_, err = s.repo.AddMember(ctx, dojoId, m)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":        true,
		"dojoId":    dojoId,
		"studentUid": studentUid,
		"status":    "approved",
	}, nil
}

func (s *Service) isStaffUser(ctx context.Context, uid string) (bool, error) {
	p, err := s.userRepo.Get(ctx, uid)
	if err == nil && p != nil {
		// あなたのフロントの保存形式に寄せてる（staff / staff_member どっちでもOK）
		if p.HasRole("staff") || p.HasRole("staff_member") || p.HasRole("admin") {
			return true, nil
		}
		return false, nil
	}

	// usersドキュメントがまだ無い場合は false（必要ならここで token claims も見る設計にできる）
	return false, nil
}

var nonSlug = regexp.MustCompile(`[^a-z0-9-]+`)
var multiDash = regexp.MustCompile(`-+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	s = nonSlug.ReplaceAllString(s, "-")
	s = multiDash.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "dojo"
	}
	return s
}
