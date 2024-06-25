#!/bin/bash

gcloud config set project thoughtlead

cd "$(dirname "$0")"
cd ../

gcloud builds submit --machine-type=e2-highcpu-32 --tag gcr.io/thoughtlead/api-staging .
gcloud run deploy api-staging --image=gcr.io/thoughtlead/api-staging:latest --region=us-east4
