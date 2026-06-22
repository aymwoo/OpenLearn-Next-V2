# Implementation Plan - Task 332ed193 (Fix MFE CORS and Private Network Access)

## Goal
Resolve the browser blockages when loading microfrontends (`remoteEntry.js`) in the Lesson Editor on the production server (`http://47.243.75.121`).

## Cause of PM2 Errored Status
Starting `pm2 start "pnpm --filter mfe-whiteboard dev"` directly fails because PM2 tries to find a script file with the entire string or fails to run it in the correct environment shell.

The standard and robust way to run a workspace package script in PM2 is to specify `pnpm` as the executable, set the working directory with `--cwd`, and pass `run dev` as arguments.

## Proposed Changes

### 1. Revert/Clear Errored PM2 Processes
```bash
pm2 delete mfe-whiteboard mfe-courseware
```

### 2. Start Microfrontend Services with Correct PM2 Arguments
- **Whiteboard (5174)**:
  ```bash
  pm2 start pnpm --name "mfe-whiteboard" --cwd "/root/OpenLearn-Next-V2/packages/mfe-whiteboard" -- run dev
  ```
- **Courseware (5175)**:
  ```bash
  pm2 start pnpm --name "mfe-courseware" --cwd "/root/OpenLearn-Next-V2/packages/mfe-courseware" -- run dev
  ```

## Verification
1. Run `pm2 list` and verify both `mfe-whiteboard` and `mfe-courseware` are in `online` status.
2. Access `http://47.243.75.121/mfe/whiteboard/remoteEntry.js` and verify it returns `200 OK`.
