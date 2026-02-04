#!/bin/bash
set -e

PROJECT_ID="dojo-manager-94b96"
REGION="us-west2"
SERVICE_NAME="dojo-backend"
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
  --set-env-vars="FIREBASE_PROJECT_ID=${PROJECT_ID},ALLOWED_ORIGINS=https://dojo-manager-94b96.web.app,PORT=8080"

echo "✅ Done!"
