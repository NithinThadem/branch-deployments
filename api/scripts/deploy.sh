#!/bin/bash

# Stop execution on any error
set -e

# Set the Google Cloud Project ID
PROJECT_ID='thoughtlead'
IMAGE_NAME='api'
REGION='us-east4'

# Configure the gcloud project
gcloud config set project $PROJECT_ID

# Navigate to the directory containing the Dockerfile
cd "$(dirname "$0")"
cd ../

# Submit a build job to Cloud Build
gcloud builds submit --machine-type=e2-highcpu-32 --tag gcr.io/$PROJECT_ID/$IMAGE_NAME .

# Deploy the image to Google Cloud Run
gcloud run deploy $IMAGE_NAME --image=gcr.io/$PROJECT_ID/$IMAGE_NAME:latest --region=$REGION
