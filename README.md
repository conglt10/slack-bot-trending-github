## Install deno

```bash
curl -fsSL https://deno.land/install.sh | sh
```


## Run

```bash
deno run --allow-net --allow-env --env main.ts
```

## Secure run

```bash
deno run \
  --allow-net=slack.com,openrouter.ai,github.com \
  --allow-env=SLACK_BOT_TOKEN,SLACK_CHANNEL,OPENROUTER_API_KEY \
  --env \
  main.ts
```
