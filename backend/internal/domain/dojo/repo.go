package dojo

import (
	"context"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Repo struct {
	fs *firestore.Client
}

func NewRepo(fs *firestore.Client) *Repo {
	return &Repo{fs: fs}
}

func (r *Repo) CreateDojo(ctx context.Context, d Dojo) (*Dojo, error) {
	ref := r.fs.Collection("dojos").NewDoc()
	d.ID = ref.ID
	_, err := ref.Create(ctx, d)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *Repo) GetDojo(ctx context.Context, dojoId string) (*Dojo, error) {
	doc, err := r.fs.Collection("dojos").Doc(dojoId).Get(ctx)
	if err != nil {
		return nil, err
	}
	var d Dojo
	if err := doc.DataTo(&d); err != nil {
		return nil, err
	}
	if d.ID == "" {
		d.ID = dojoId
	}
	return &d, nil
}

func (r *Repo) SearchDojosByNamePrefix(ctx context.Context, q string, limit int64) ([]Dojo, error) {
	q = strings.TrimSpace(strings.ToLower(q))
	col := r.fs.Collection("dojos")

	// if q empty, return recent 20
	var it *firestore.DocumentIterator
	if q == "" {
		it = col.OrderBy("createdAt", firestore.Desc).Limit(int(limit)).Documents(ctx)
	} else {
		// prefix search on nameLower (requires index sometimes depending on project)
		hi := q + "\uf8ff"
		it = col.Where("nameLower", ">=", q).
			Where("nameLower", "<", hi).
			OrderBy("nameLower", firestore.Asc).
			Limit(int(limit)).
			Documents(ctx)
	}

	out := []Dojo{}
	for {
		doc, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var d Dojo
		if err := doc.DataTo(&d); err != nil {
			return nil, err
		}
		if d.ID == "" {
			d.ID = doc.Ref.ID
		}
		out = append(out, d)
	}
	return out, nil
}

func (r *Repo) PutJoinRequest(ctx context.Context, dojoId, uid string, jr JoinRequest) (*JoinRequest, error) {
	ref := r.fs.Collection("dojos").Doc(dojoId).Collection("joinRequests").Doc(uid)
	_, err := ref.Set(ctx, jr, firestore.MergeAll)
	if err != nil {
		return nil, err
	}
	return &jr, nil
}

func (r *Repo) GetJoinRequest(ctx context.Context, dojoId, uid string) (*JoinRequest, error) {
	doc, err := r.fs.Collection("dojos").Doc(dojoId).Collection("joinRequests").Doc(uid).Get(ctx)
	if err != nil {
		return nil, err
	}
	var jr JoinRequest
	if err := doc.DataTo(&jr); err != nil {
		return nil, err
	}
	return &jr, nil
}

func (r *Repo) AddMember(ctx context.Context, dojoId string, m Membership) (*Membership, error) {
	ref := r.fs.Collection("dojos").Doc(dojoId).Collection("members").Doc(m.UID)
	_, err := ref.Set(ctx, m, firestore.MergeAll)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repo) IsStaff(ctx context.Context, dojoId, uid string) (bool, error) {
	d, err := r.GetDojo(ctx, dojoId)
	if err != nil {
		return false, err
	}

	// Check if owner (single ownerUid field)
	if d.OwnerUID == uid {
		return true, nil
	}

	// Check createdBy
	if d.CreatedBy == uid {
		return true, nil
	}

	// Check ownerIds array
	for _, o := range d.OwnerIds {
		if o == uid {
			return true, nil
		}
	}

	// Check staffUids array
	for _, s := range d.StaffUids {
		if s == uid {
			return true, nil
		}
	}

	// Check members subcollection for staff role
	memberDoc, err := r.fs.Collection("dojos").Doc(dojoId).Collection("members").Doc(uid).Get(ctx)
	if err == nil && memberDoc.Exists() {
		data := memberDoc.Data()
		if role, ok := data["role"].(string); ok {
			switch role {
			case "owner", "admin", "staff", "staff_member", "coach", "instructor":
				return true, nil
			}
		}
		if roleInDojo, ok := data["roleInDojo"].(string); ok {
			switch roleInDojo {
			case "owner", "admin", "staff", "staff_member", "coach", "instructor":
				return true, nil
			}
		}
	}

	return false, nil
}

func now() time.Time { return time.Now().UTC() }
