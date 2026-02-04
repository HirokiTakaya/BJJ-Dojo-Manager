package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"

	"dojo-manager/backend/internal/config"
	"dojo-manager/backend/internal/firebase"
	"dojo-manager/backend/internal/httpjson"

	credentials "cloud.google.com/go/iam/credentials/apiv1"
	credentialspb "cloud.google.com/go/iam/credentials/apiv1/credentialspb"
	"cloud.google.com/go/storage"
)

type Uploads struct {
	cfg     config.Config
	clients *firebase.Clients
	iam     *credentials.IamCredentialsClient
}

func NewUploads(cfg config.Config, clients *firebase.Clients) *Uploads {
	// IAM client is optional; only needed for signed URLs.
	iamClient, _ := credentials.NewIamCredentialsClient(context.Background())
	return &Uploads{cfg: cfg, clients: clients, iam: iamClient}
}

type signedURLReq struct {
	ObjectPath     string `json:"objectPath"` // e.g. "dojos/{dojoId}/logos/logo.png"
	ContentType    string `json:"contentType,omitempty"`
	ExpiresSeconds int64  `json:"expiresSeconds,omitempty"` // default 900
}

type signedURLResp struct {
	URL       string `json:"url"`
	Method    string `json:"method"`
	ExpiresAt int64  `json:"expiresAt"`
}

func (h *Uploads) CreateSignedUploadURL(w http.ResponseWriter, r *http.Request) {
	var req signedURLReq
	if err := httpjson.Read(r, &req); err != nil || req.ObjectPath == "" {
		httpjson.Error(w, http.StatusBadRequest, "objectPath is required")
		return
	}
	url, exp, err := h.signedURL(r.Context(), req.ObjectPath, req.ContentType, req.ExpiresSeconds)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpjson.Write(w, http.StatusOK, signedURLResp{URL: url, Method: "PUT", ExpiresAt: exp.Unix()})
}

type signedURLsReq struct {
	Items []signedURLReq `json:"items"`
}

func (h *Uploads) CreateSignedUploadURLs(w http.ResponseWriter, r *http.Request) {
	var req signedURLsReq
	if err := httpjson.Read(r, &req); err != nil || len(req.Items) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "items is required")
		return
	}
	out := make([]signedURLResp, 0, len(req.Items))
	for _, it := range req.Items {
		if it.ObjectPath == "" {
			continue
		}
		url, exp, err := h.signedURL(r.Context(), it.ObjectPath, it.ContentType, it.ExpiresSeconds)
		if err != nil {
			// return partial success info (keep it simple)
			out = append(out, signedURLResp{URL: "", Method: "PUT", ExpiresAt: 0})
			continue
		}
		out = append(out, signedURLResp{URL: url, Method: "PUT", ExpiresAt: exp.Unix()})
	}
	httpjson.Write(w, http.StatusOK, map[string]interface{}{"items": out})
}

func (h *Uploads) signedURL(ctx context.Context, objectPath, contentType string, expiresSeconds int64) (string, time.Time, error) {
	if h.cfg.StorageBucket == "" {
		return "", time.Time{}, fmt.Errorf("FIREBASE_STORAGE_BUCKET is not set")
	}
	if h.cfg.SignedURLServiceAccountEmail == "" {
		return "", time.Time{}, fmt.Errorf("SIGNED_URL_SERVICE_ACCOUNT_EMAIL is not set")
	}
	if h.iam == nil {
		return "", time.Time{}, fmt.Errorf("IAM credentials client not available")
	}
	if expiresSeconds <= 0 || expiresSeconds > 3600 {
		expiresSeconds = 900
	}
	exp := time.Now().Add(time.Duration(expiresSeconds) * time.Second)

	// V4 signed URL for PUT (upload).
	opts := &storage.SignedURLOptions{
		Scheme:         storage.SigningSchemeV4,
		Method:         "PUT",
		Expires:        exp,
		ContentType:    contentType,
		GoogleAccessID: h.cfg.SignedURLServiceAccountEmail,
		SignBytes: func(b []byte) ([]byte, error) {
			name := fmt.Sprintf("projects/-/serviceAccounts/%s", h.cfg.SignedURLServiceAccountEmail)
			resp, err := h.iam.SignBlob(ctx, &credentialspb.SignBlobRequest{
				Name:    name,
				Payload: b,
			})
			if err != nil {
				return nil, err
			}
			// resp.SignedBlob is raw bytes; keep as-is.
			return resp.SignedBlob, nil
		},
	}

	// Some clients like to know the expected Content-Type; if blank, omit to allow any.
	if opts.ContentType == "" {
		opts.ContentType = "application/octet-stream"
	}

	url, err := storage.SignedURL(h.cfg.StorageBucket, objectPath, opts)
	if err != nil {
		// Helpful error message for common misconfigs.
		return "", time.Time{}, fmt.Errorf("failed to sign url (check service account + permissions): %v", err)
	}

	// Optional: include base64 of path as debug for clients (not required)
	_ = base64.StdEncoding.EncodeToString([]byte(objectPath))

	return url, exp, nil
}
