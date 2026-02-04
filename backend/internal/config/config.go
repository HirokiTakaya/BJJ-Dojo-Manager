
package config

import (
	"os"
	"strings"
)

type Config struct {
	ProjectID                    string
	Port                         string
	AllowedOrigins               []string
	StorageBucket                string
	StripeSecretKey              string
	StripeWebhookSecret          string
	SignedURLServiceAccountEmail string
}

func Load() Config {
	// FIREBASE_PROJECT_ID または GOOGLE_CLOUD_PROJECT を読む
	projectID := getenv("FIREBASE_PROJECT_ID", "")
	if projectID == "" {
		projectID = getenv("GOOGLE_CLOUD_PROJECT", "")
	}
	
	port := getenv("PORT", "8080")
	origins := getenv("ALLOWED_ORIGINS", "http://localhost:3000")
	storageBucket := getenv("FIREBASE_STORAGE_BUCKET", "")
	if storageBucket == "" && projectID != "" {
		storageBucket = projectID + ".appspot.com"
	}
	stripeSecretKey := getenv("STRIPE_SECRET_KEY", "")
	stripeWebhookSecret := getenv("STRIPE_WEBHOOK_SECRET", "")
	signedURLServiceAccountEmail := getenv("SIGNED_URL_SERVICE_ACCOUNT_EMAIL", "")

	allowed := []string{}
	for _, o := range strings.Split(origins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed = append(allowed, o)
		}
	}

	return Config{
		ProjectID:                    projectID,
		Port:                         port,
		AllowedOrigins:               allowed,
		StorageBucket:                storageBucket,
		StripeSecretKey:              stripeSecretKey,
		StripeWebhookSecret:          stripeWebhookSecret,
		SignedURLServiceAccountEmail: signedURLServiceAccountEmail,
	}
}

func getenv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}
