#!/bin/bash
set -e

PROJECT_ID="dojo-manager-94b96"
REGION="asia-northeast1"
SERVICE_NAME="dojo-api"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🔨 Building Docker image locally..."
docker build --platform linux/amd64 -t ${IMAGE_NAME} .

echo "📤 Pushing to Container Registry..."
docker push ${IMAGE_NAME}

echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=${PROJECT_ID},ALLOWED_ORIGINS=https://dojo-manager-94b96.web.app,PORT=8080,STRIPE_PRICE_PRO_MONTHLY=price_1SxaV3P4p3bl8wFbyN4xoJtJ,STRIPE_PRICE_PRO_YEARLY=price_1SxaZNP4p3bl8wFbOLGYhIH2,STRIPE_PRICE_BUSINESS_MONTHLY=price_1SxaZNP4p3bl8wFbCDHUsNYR,STRIPE_PRICE_BUSINESS_YEARLY=price_1SxaauP4p3bl8wFbb7sns5LG" \
  --set-secrets="STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest"

echo "✅ Done!"
