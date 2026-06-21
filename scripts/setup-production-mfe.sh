#!/usr/bin/env bash
# OpenLearnV2 MFE Production database setup script
# Sets the whiteboard and courseware entries to relative paths for Nginx reverse proxy

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DB_PATH="$ROOT/packages/core/db/educational_os.db"

if [ ! -f "$DB_PATH" ]; then
    # Fallback to absolute production path on the server
    DB_PATH="/root/OpenLearn-Next-V2/packages/core/db/educational_os.db"
fi

if [ -f "$DB_PATH" ]; then
    echo "Found SQLite database at: $DB_PATH"
    
    # Run SQLite updates
    sqlite3 "$DB_PATH" "UPDATE mfe_remotes SET entry = '/mfe/whiteboard/remoteEntry.js' WHERE name = 'mfe_whiteboard';"
    sqlite3 "$DB_PATH" "UPDATE mfe_remotes SET entry = '/mfe/courseware/remoteEntry.js' WHERE name = 'mfe_courseware';"
    
    echo "✅ Successfully updated mfe_remotes entries to relative paths '/mfe/whiteboard/...' and '/mfe/courseware/...'"
    echo "Please reload Nginx and restart PM2."
else
    echo "❌ SQLite database file not found at: $DB_PATH"
    exit 1
fi
