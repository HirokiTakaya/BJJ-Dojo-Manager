
#!/bin/bash
set -e

PROJECT_ID="dojo-manager-94b96"
REGION="asia-northeast1"
SERVICE_NAME="dojo-api"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🔨 Building image with Cloud Build (no local Docker needed)..."
gcloud builds submit --tag ${IMAGE_NAME} --project ${PROJECT_ID}

echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=${PROJECT_ID},ALLOWED_ORIGINS=https://dojo-manager-94b96.web.app,STRIPE_PRICE_PRO_MONTHLY=price_1TNbMU1YsWpgXtYfcouqIMZ5,STRIPE_PRICE_PRO_YEARLY=price_1TNelm1YsWpgXtYft0p1huxG,STRIPE_PRICE_BUSINESS_MONTHLY=price_1TNbUl1YsWpgXtYfPjenirs9,STRIPE_PRICE_BUSINESS_YEARLY=price_1TNekR1YsWpgXtYfp73z8cXw" \
  --set-secrets="STRIPE_SECRET_KEY=stripe-secret-key-prod:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret-prod:latest,STRIPE_CONNECT_WEBHOOK_SECRET=stripe-connect-webhook-secret-prod:latest"

# ── Connect secret作成後はこちらに差し替え:
#  --set-secrets="STRIPE_SECRET_KEY=stripe-secret-key-prod:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret-prod:latest,STRIPE_CONNECT_WEBHOOK_SECRET=stripe-connect-webhook-secret-prod:latest"

echo "✅ Done!"