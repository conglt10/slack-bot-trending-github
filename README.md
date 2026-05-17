## Install deno

https://docs.deno.com/runtime/getting_started/installation/

## Run

```bash
deno run --allow-net --allow-env --env main.ts
```

```bash
deno run --allow-net --allow-env --env main.ts "0 14 * * 1,3,5"; # Mon, Wed, Fri at 14h
```

## Secure run

```bash
deno run \
  --allow-net=slack.com,openrouter.ai,github.com \
  --allow-env=SLACK_BOT_TOKEN,SLACK_CHANNEL,OPENROUTER_API_KEY \
  --env \
  main.ts
```

## Deploy code

### 1. Use Deno Deploy

https://docs.deno.com/deploy/

### 2. Use pm2

```bash
npm install pm2 -g
```

```bash
pm2 start ./run.sh
```
