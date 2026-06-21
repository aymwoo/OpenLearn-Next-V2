# Diagnostics & Recovery Plan - Task 332ed193 (SQLite Readonly Database Error)

## Goal
Resolve the SQLite `attempt to write a readonly database` error occurring on the production server under PM2.

## Background & Causes
SQLite requires write access to **both** the database file (`educational_os.db`) and its **parent directory** (`packages/core/db/`) in order to:
1. Write to the database file itself.
2. Create and modify lock/journal files (like `-journal`, `-wal`, or `-shm`) in the same directory during write transactions.

Since the project is hosted in `/root/OpenLearn-Next-V2/`, the typical causes of this error on a Linux server are:
1. **User Permission Mismatch**: The PM2 process runs as a non-root user (e.g., `node`, `pm2`, or `www-data`), but `/root/` is only accessible by `root` (usually permissions `drwx------`).
2. **File Permissions**: The database file `/root/OpenLearn-Next-V2/packages/core/db/educational_os.db` does not have write permissions for the user running PM2.
3. **Directory Permissions**: The folder `/root/OpenLearn-Next-V2/packages/core/db/` does not have write permissions for the user running PM2.
4. **Ownership**: The database file or directory is owned by `root`, while PM2 runs under another user.

## Diagnostics (To run on production server)
To inspect ownership and permissions on the server:
```bash
# 1. Check which user runs the pm2 process
ps aux | grep pm2

# 2. Check the directory and database permissions
ls -la /root/OpenLearn-Next-V2/packages/core/db/
```

## Solutions & Resolution Steps

### Option A: PM2 runs as root (Fix file permissions)
If PM2 runs as `root` but permissions were somehow messed up:
```bash
# Grant read/write permissions to the database file
chmod 664 /root/OpenLearn-Next-V2/packages/core/db/educational_os.db

# Grant read/write/execute permissions to the parent directory (required for lock files)
chmod 775 /root/OpenLearn-Next-V2/packages/core/db/
```

### Option B: PM2 runs as a non-root user (Fix ownership)
If PM2 runs as a different user (e.g., `wuxf`), change ownership of the directory and the database file to that user:
```bash
# Change owner (replace 'wuxf:wuxf' with the actual user/group running PM2)
chown -R wuxf:wuxf /root/OpenLearn-Next-V2/packages/core/db/
```

### Option C: Quick permissions fix (chmod 777)
If ownership setup is complex, quickly allow any user to read/write the database and directory:
```bash
chmod 777 /root/OpenLearn-Next-V2/packages/core/db/
chmod 666 /root/OpenLearn-Next-V2/packages/core/db/educational_os.db
```
*(After running one of the above on the server, restart the PM2 application: `pm2 restart openlear`)*
