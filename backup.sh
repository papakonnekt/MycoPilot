#!/bin/bash
set -e

# Default configurations (can be overridden by environment variables)
DB_PATH="${DB_PATH:-/app/data/myco.db}"
GITHUB_PAT="${GITHUB_PAT:-}"
GITHUB_REPO="${GITHUB_REPO:-papakonnekt/myco-operations}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
BACKUP_TEMP_DIR="/tmp/myco-backup-repo"
BACKUP_FILE_NAME="myco_backup.db"

echo "=== Myco Database Backup Initiated: $(date) ==="

# 1. Validation
if [ ! -f "$DB_PATH" ]; then
  echo "Error: Database file not found at '$DB_PATH'."
  exit 1
fi

if [ -z "$GITHUB_PAT" ]; then
  echo "Error: GITHUB_PAT environment variable is not set. Cannot authenticate to GitHub."
  exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO environment variable is not set."
  exit 1
fi

# 2. Safely create live database snapshot using SQLite .backup command
# This prevents database locks or corruption on the active WAL-mode database.
echo "Creating safe SQLite backup snapshot of '$DB_PATH'..."
sqlite3 "$DB_PATH" ".backup '/tmp/$BACKUP_FILE_NAME'"
echo "Backup snapshot created at '/tmp/$BACKUP_FILE_NAME'."

# 3. Clone, commit and push to the private GitHub repository
echo "Cleaning old temp directories..."
rm -rf "$BACKUP_TEMP_DIR"
mkdir -p "$BACKUP_TEMP_DIR"
cd "$BACKUP_TEMP_DIR"

echo "Cloning private repository '${GITHUB_REPO}' branch '${GITHUB_BRANCH}'..."
# Use GitHub PAT in URL for secure HTTPS authentication without SSH keys
REPO_URL="https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_REPO}.git"

# Clone only the target branch with depth 1 to save bandwidth/space
git clone --depth 1 --branch "$GITHUB_BRANCH" "$REPO_URL" . || {
  echo "Branch '${GITHUB_BRANCH}' does not exist or clone failed. Attempting to clone default branch..."
  git clone --depth 1 "$REPO_URL" . || {
    # If the repository is completely empty, initialize it locally
    echo "Repository is empty. Initializing git repository..."
    git init
    git remote add origin "$REPO_URL"
  }
  echo "Checking out/creating branch '${GITHUB_BRANCH}'..."
  git checkout -b "$GITHUB_BRANCH" || git checkout "$GITHUB_BRANCH"
}

# Move the backup snapshot into the cloned repo
mv "/tmp/$BACKUP_FILE_NAME" "./$BACKUP_FILE_NAME"

# Configure local git user metadata for this commit
git config user.name "Myco Backup Bot"
git config user.email "backup-bot@myco.internal"

# Stage the file
git add "$BACKUP_FILE_NAME"

# Commit only if changes exist (avoids empty commits)
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
if git diff-index --quiet HEAD --; then
  echo "No database changes detected since last backup. Skipping push."
else
  echo "Committing database backup..."
  git commit -m "database backup: $TIMESTAMP"
  echo "Pushing database backup to remote branch '${GITHUB_BRANCH}'..."
  git push -u origin "$GITHUB_BRANCH"
  echo "Database backup pushed successfully!"
fi

# 4. Clean up temp files
echo "Cleaning up temp files..."
cd /
rm -rf "$BACKUP_TEMP_DIR"
echo "=== Backup Process Completed Successfully! ==="
