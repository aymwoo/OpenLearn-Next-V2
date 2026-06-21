# Implementation Plan - Task 332ed193 (Fix MFE CORS and Private Network Access)

## Goal
Resolve the browser blockages when loading microfrontends (`remoteEntry.js`) in the Lesson Editor on the production server (`http://47.243.75.121`).

## Background & Causes
The error `Access to script at 'http://localhost:5174/remoteEntry.js' from origin 'http://47.243.75.121' has been blocked by CORS policy: The request client is not a secure context and the resource is in more-private address space loopback` occurs because:
1. The database `mfe_remotes` table seeds microfrontends with `localhost:5174` and `localhost:5175`.
2. When a user accesses the site remotely (`http://47.243.75.121`), `localhost` resolves to the **user's local computer** instead of the server.
3. Modern browser security policies (Private Network Access / PNA) block insecure public websites (`http` IP origins) from making requests to local loopback addresses (`localhost`/`127.0.0.1`).

## Solution Options

### Option 1: Nginx Reverse Proxy (Highly Recommended for Production)
Proxy both microfrontends behind the same domain/IP using Nginx. This resolves all CORS and PNA issues, and keeps ports 5174/5175 closed to the public internet.

1. **Update Nginx configuration** on the server to add reverse proxies for `/mfe/whiteboard/` and `/mfe/courseware/`:
   ```nginx
   server {
       listen 80;
       server_name 47.243.75.121; # Or your domain name

       location / {
           proxy_pass http://127.0.0.1:9000; # Main server
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # Whiteboard MFE Proxy
       location /mfe/whiteboard/ {
           proxy_pass http://127.0.0.1:5174/; # Note the trailing slash!
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       # Courseware MFE Proxy
       location /mfe/courseware/ {
           proxy_pass http://127.0.0.1:5175/; # Note the trailing slash!
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```
2. **Update the database entries** on the server to use relative paths using the Node setup script:
   ```bash
   node scripts/setup-production-mfe.mjs
   ```

---

### Option 2: Public Port Access (Alternative)
Directly expose the microfrontend ports to the public, which requires opening ports `5174` and `5175` in the server's firewall (e.g. Security Groups).

1. **Update the Vite host** in `packages/mfe-whiteboard/vite.config.ts` and `packages/mfe-courseware/vite.config.ts` from `127.0.0.1` to `0.0.0.0` so they listen publicly:
   ```typescript
   // In vite.config.ts server block:
   host: '0.0.0.0'
   ```
2. **Update the database entries** on the server to use the public IP:
   ```bash
   # (Using SQLite directly if sqlite3 command is available, or update using a node script)
   sqlite3 /root/OpenLearn-Next-V2/packages/core/db/educational_os.db "UPDATE mfe_remotes SET entry = 'http://47.243.75.121:5174/remoteEntry.js' WHERE name = 'mfe_whiteboard';"
   sqlite3 /root/OpenLearn-Next-V2/packages/core/db/educational_os.db "UPDATE mfe_remotes SET entry = 'http://47.243.75.121:5175/remoteEntry.js' WHERE name = 'mfe_courseware';"
   ```
