#!/usr/bin/env bash
# ==============================================================================
# setup_gcs.sh
# Sets up Google Cloud Storage bucket, lifecycle rules, Service Account,
# and Workload Identity Federation (WIF) for GitHub Actions.
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-drift-platform-prod}"
REGION="${GCP_REGION:-us-central1}"
BUCKET_NAME="${GCS_BUCKET_NAME:-drift-platform-data}"
SA_NAME="sa-drift-worker"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_POOL_NAME="github-actions-pool"
WIF_PROVIDER_NAME="github-provider"
GITHUB_REPO="${GITHUB_REPO:-your-org/drift-platform}"

echo "============================================================"
echo "Configuring GCS and Cloud IAM for Drift Platform"
echo "Project: $PROJECT_ID | Region: $REGION | Bucket: $BUCKET_NAME"
echo "============================================================"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "[WARN] 'gcloud' CLI is not found in PATH."
    echo "[INFO] For local development, GCS_LOCAL_MOCK_DIR is used instead."
    echo "[INFO] Review this script for production GCP deployment instructions."
    exit 0
fi

# 1. Create GCS Bucket
echo "[1/4] Ensuring GCS bucket exists..."
if ! gsutil ls -b "gs://${BUCKET_NAME}" &>/dev/null; then
    gsutil mb -p "${PROJECT_ID}" -c standard -l "${REGION}" -b on "gs://${BUCKET_NAME}"
    echo "Created bucket gs://${BUCKET_NAME}"
else
    echo "Bucket gs://${BUCKET_NAME} already exists."
fi

# Enable Uniform Bucket-Level Access
gsutil uniformbucketlevelaccess set on "gs://${BUCKET_NAME}"

# 2. Configure Bucket Lifecycle Policy
echo "[2/4] Applying Parquet Log Lifecycle Policy..."
LIFECYCLE_FILE=$(mktemp)
cat <<EOF > "${LIFECYCLE_FILE}"
{
  "rule": [
    {
      "action": {
        "type": "SetStorageClass",
        "storageClass": "NEARLINE"
      },
      "condition": {
        "age": 30,
        "matchesPrefix": ["inference_logs/"]
      }
    },
    {
      "action": {
        "type": "SetStorageClass",
        "storageClass": "COLDLINE"
      },
      "condition": {
        "age": 90,
        "matchesPrefix": ["inference_logs/"]
      }
    },
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "age": 180,
        "matchesPrefix": ["inference_logs/"]
      }
    }
  ]
}
EOF

gsutil lifecycle set "${LIFECYCLE_FILE}" "gs://${BUCKET_NAME}"
rm -f "${LIFECYCLE_FILE}"
echo "Lifecycle rules configured (Nearline 30d, Coldline 90d, Expiry 180d)."

# 3. Create Service Account and Grant IAM Permissions
echo "[3/4] Creating Service Account and Assigning Permissions..."
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" &>/dev/null; then
    gcloud iam service-accounts create "${SA_NAME}" \
        --description="Service account for automated drift worker and retraining" \
        --display-name="Drift Platform Worker" \
        --project="${PROJECT_ID}"
fi

gsutil iam ch "serviceAccount:${SA_EMAIL}:roles/storage.objectAdmin" "gs://${BUCKET_NAME}"

# 4. Configure Workload Identity Federation (WIF) for GitHub Actions
echo "[4/4] Setting up Workload Identity Federation for GitHub Actions..."
# Create Workload Identity Pool
if ! gcloud iam workload-identity-pools describe "${WIF_POOL_NAME}" --location="global" --project="${PROJECT_ID}" &>/dev/null; then
    gcloud iam workload-identity-pools create "${WIF_POOL_NAME}" \
        --project="${PROJECT_ID}" \
        --location="global" \
        --display-name="GitHub Actions Pool"
fi

# Create OIDC Provider
if ! gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER_NAME}" \
    --workload-identity-pool="${WIF_POOL_NAME}" \
    --location="global" \
    --project="${PROJECT_ID}" &>/dev/null; then
    gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER_NAME}" \
        --project="${PROJECT_ID}" \
        --location="global" \
        --workload-identity-pool="${WIF_POOL_NAME}" \
        --display-name="GitHub Actions OIDC Provider" \
        --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
        --issuer-uri="https://token.actions.githubusercontent.com"
fi

# Allow GitHub Actions repo to impersonate service account
WIF_POOL_ID=$(gcloud iam workload-identity-pools describe "${WIF_POOL_NAME}" --location="global" --project="${PROJECT_ID}" --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${WIF_POOL_ID}/attribute.repository/${GITHUB_REPO}"

echo "============================================================"
echo "GCS & WIF Setup Complete!"
echo "WIF Provider: ${WIF_POOL_ID}/providers/${WIF_PROVIDER_NAME}"
echo "Service Account: ${SA_EMAIL}"
echo "============================================================"
