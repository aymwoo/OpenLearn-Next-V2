# Implementation Plan - Task 332ed193 (Fix MFE CORS and Private Network Access)

## Goal
Resolve the browser blockages when loading microfrontends (`remoteEntry.js`) in the Lesson Editor on the production server (`http://47.243.75.121`).

## Cause of 502 (Bad Gateway)
The `502 (Bad Gateway)` error for `http://47.243.75.121/mfe/whiteboard/remoteEntry.js` means Nginx was successfully configured to proxy MFE requests, but the target microfrontend services (port `5174` and `5175`) are **not running** on the production server.

Since these microfrontends do not have static entry pages (`index.html`) to compile, they must run as on-the-fly compiling services (Vite dev servers) on the production server, bound to `127.0.0.1` and proxied by Nginx.

## Proposed Changes

### 1. Revert Root Build Script
Keep the root build script as originally defined (building host and server, compiling plugins):
```json
"build": "node scripts/build-plugins.mjs && vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs"
```

### 2. Start Microfrontend Dev Servers in PM2 on the Server
Start the whiteboard and courseware Vite compiling servers in the background using PM2:
- **Whiteboard (5174)**: `pm2 start "pnpm --filter mfe-whiteboard dev" --name "mfe-whiteboard"`
- **Courseware (5175)**: `pm2 start "pnpm --filter mfe-courseware dev" --name "mfe-courseware"`

## Verification
1. Verify the microfrontend processes are running: `pm2 list`.
2. Access `http://47.243.75.121/mfe/whiteboard/remoteEntry.js` and verify it returns `200 OK` (no 502).
