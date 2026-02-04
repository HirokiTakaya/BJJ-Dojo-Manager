package ranks

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Repo struct {
	client *firestore.Client
}

func NewRepo(client *firestore.Client) *Repo {
	return &Repo{client: client}
}

func (r *Repo) memberRef(dojoID, memberUID string) *firestore.DocumentRef {
	return r.client.Collection("dojos").Doc(dojoID).Collection("members").Doc(memberUID)
}

func (r *Repo) rankHistoryCol(dojoID, memberUID string) *firestore.CollectionRef {
	return r.memberRef(dojoID, memberUID).Collection("rankHistory")
}

// GetMemberRank gets a member's current rank
func (r *Repo) GetMemberRank(ctx context.Context, dojoID, memberUID string) (string, int, error) {
	doc, err := r.memberRef(dojoID, memberUID).Get(ctx)
	if err != nil {
		return "", 0, fmt.Errorf("%w: member not found", ErrNotFound)
	}

	data := doc.Data()
	beltRank, _ := data["beltRank"].(string)
	if beltRank == "" {
		beltRank = "white"
	}
	stripes, _ := data["stripes"].(int64)

	return beltRank, int(stripes), nil
}

// UpdateMemberRank updates a member's rank
func (r *Repo) UpdateMemberRank(ctx context.Context, dojoID, memberUID, promoterUID, beltRank string, stripes int, notes string) error {
	now := time.Now().UTC()

	// Get current rank
	currentBelt, currentStripes, _ := r.GetMemberRank(ctx, dojoID, memberUID)

	batch := r.client.Batch()

	// Update member
	memberRef := r.memberRef(dojoID, memberUID)
	batch.Set(memberRef, map[string]interface{}{
		"beltRank":        beltRank,
		"stripes":         stripes,
		"lastPromotionAt": now,
		"lastPromotedBy":  promoterUID,
		"updatedAt":       now,
	}, firestore.MergeAll)

	// Create history record
	historyRef := r.rankHistoryCol(dojoID, memberUID).NewDoc()
	batch.Set(historyRef, map[string]interface{}{
		"previousBelt":    currentBelt,
		"previousStripes": currentStripes,
		"newBelt":         beltRank,
		"newStripes":      stripes,
		"promotedBy":      promoterUID,
		"notes":           notes,
		"createdAt":       now,
	})

	_, err := batch.Commit(ctx)
	return err
}

// AddStripe adds a stripe to a member
func (r *Repo) AddStripe(ctx context.Context, dojoID, memberUID, promoterUID, notes string) (int, int, error) {
	currentBelt, currentStripes, err := r.GetMemberRank(ctx, dojoID, memberUID)
	if err != nil {
		return 0, 0, err
	}

	if currentStripes >= 4 {
		return 0, 0, fmt.Errorf("%w: maximum stripes (4) reached", ErrBadRequest)
	}

	newStripes := currentStripes + 1
	now := time.Now().UTC()

	batch := r.client.Batch()

	// Update member
	memberRef := r.memberRef(dojoID, memberUID)
	batch.Set(memberRef, map[string]interface{}{
		"stripes":         newStripes,
		"lastPromotionAt": now,
		"lastPromotedBy":  promoterUID,
		"updatedAt":       now,
	}, firestore.MergeAll)

	// Create history record
	historyRef := r.rankHistoryCol(dojoID, memberUID).NewDoc()
	notesText := notes
	if notesText == "" {
		notesText = "Stripe added"
	}
	batch.Set(historyRef, map[string]interface{}{
		"previousBelt":    currentBelt,
		"previousStripes": currentStripes,
		"newBelt":         currentBelt,
		"newStripes":      newStripes,
		"promotedBy":      promoterUID,
		"notes":           notesText,
		"createdAt":       now,
	})

	if _, err := batch.Commit(ctx); err != nil {
		return 0, 0, err
	}

	return currentStripes, newStripes, nil
}

// GetRankHistory gets rank history for a member
func (r *Repo) GetRankHistory(ctx context.Context, dojoID, memberUID string, limit int) ([]RankHistory, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}

	iter := r.rankHistoryCol(dojoID, memberUID).
		OrderBy("createdAt", firestore.Desc).
		Limit(limit).
		Documents(ctx)

	var history []RankHistory
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get rank history: %w", err)
		}

		var h RankHistory
		if err := doc.DataTo(&h); err != nil {
			continue
		}
		h.ID = doc.Ref.ID
		history = append(history, h)
	}

	return history, nil
}

// GetBeltDistribution gets belt distribution for a dojo
func (r *Repo) GetBeltDistribution(ctx context.Context, dojoID string) (*BeltDistributionResult, error) {
	iter := r.client.Collection("dojos").Doc(dojoID).Collection("members").
		Where("status", "==", "active").
		Documents(ctx)

	distribution := make(map[string]int)
	stripesDistribution := make(map[string]map[int]int)

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get members: %w", err)
		}

		data := doc.Data()
		belt, _ := data["beltRank"].(string)
		if belt == "" {
			belt = "white"
		}
		stripes, _ := data["stripes"].(int64)

		distribution[belt]++

		if stripesDistribution[belt] == nil {
			stripesDistribution[belt] = make(map[int]int)
		}
		stripesDistribution[belt][int(stripes)]++
	}

	// Build sorted result
	var result []BeltDistribution
	allBelts := append(BeltOrder, KidsBeltOrder...)
	seen := make(map[string]bool)

	for _, belt := range allBelts {
		if seen[belt] {
			continue
		}
		seen[belt] = true
		if count, ok := distribution[belt]; ok {
			result = append(result, BeltDistribution{
				Belt:    belt,
				Count:   count,
				Stripes: stripesDistribution[belt],
			})
		}
	}

	// Add any unknown belts
	for belt, count := range distribution {
		if !seen[belt] {
			result = append(result, BeltDistribution{
				Belt:    belt,
				Count:   count,
				Stripes: stripesDistribution[belt],
			})
		}
	}

	total := 0
	for _, count := range distribution {
		total += count
	}

	return &BeltDistributionResult{
		Total:        total,
		Distribution: result,
	}, nil
}
