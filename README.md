## Install deno

https://docs.deno.com/runtime/getting_started/installation/

## Run

```bash
deno task start
```

```bash
deno task start "0 14 * * 1,3,5" # Mon, Wed, Fri at 14h (Asia/Ho_Chi_Minh)
```

Run the job once and exit (useful for CI/cron-job.org):

```bash
deno task once
```

## Secure run

```bash
deno run \
  --allow-net=slack.com,openrouter.ai,github.com \
  --allow-env \
  --allow-sys=osRelease \
  --env \
  main.ts
```

Notes on permissions:

- `--allow-env` must stay unrestricted, because `@slack/web-api` pulls in `debug`,
  which calls `Object.keys(process.env)` at import time. An allowlist such as
  `--allow-env=SLACK_BOT_TOKEN` makes the bot crash with `Requires env access`.
- `--allow-sys=osRelease` is required by `@slack/web-api` (telemetry reads
  `os.release()`).

## Deploy code

### 1. Deno Deploy (entrypoint: `main.ts`)

Deno Deploy has no process to keep alive, so `main.ts` detects the platform via
`DENO_DEPLOYMENT_ID` and switches to `Deno.cron` + `Deno.serve` instead of the
in-process `croner` scheduler.

Steps:

1. Push the repo to GitHub and create a Deno Deploy app from it.
   Entrypoint: `main.ts`. No build step, no install step.
2. Add the environment variables in Deno Deploy → Settings → Environment Variables
   (`.env` is **not** uploaded, secrets must be set here):
   - `SLACK_BOT_TOKEN`
   - `SLACK_CHANNEL`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL` (optional, defaults to `openai/gpt-oss-120b:free`)
   - `TRIGGER_TOKEN` (optional, enables the manual trigger below)
3. Deploy. In the build log you should see exactly one line:
   `Deno Deploy: đã đăng ký cron "0 3 * * 1" (UTC) và HTTP handler.`

Cron schedule note: **`Deno.cron` always uses UTC.** `0 3 * * 1` = 10:00 Monday
in Vietnam (UTC+7). Change it in `defaultCronExpr` in `main.ts`.

Cron jobs are registered on **every timeline** (production, git branch, preview).
The handler checks `DENO_TIMELINE` and skips anything that is not `production`,
so a branch deploy cannot post duplicate messages to Slack.

Manual trigger (runs the job immediately, useful for testing):

```bash
curl "https://<your-app>.deno.dev/run?token=<TRIGGER_TOKEN>"
```

Health check: `GET /` returns `ok`.

Common Deno Deploy errors and their cause:

| Log stage | Typical cause |
| --- | --- |
| `Warm up` / `Route` failed, scheduler log printed repeatedly | the entrypoint never finishes evaluating (an in-process scheduler blocks it) or no HTTP handler is registered |
| `Register crons` failed | `Deno.cron` was not called during the first module evaluation, or the module threw before reaching it |
| Only `ok` but no cron | the app was deployed without the `main.ts` entrypoint |

### 2. Use pm2 (always-on VM/laptop)

```bash
npm install pm2 -g
pm2 start ./run.sh
```

### 3. Other free options

- GitHub Actions scheduled workflow: `deno task once` with secrets, no always-on host needed.
- Render/fly/Koyeb free tiers spin idle instances down, which kills an in-process scheduler;
  use `--once` with an external cron instead.
