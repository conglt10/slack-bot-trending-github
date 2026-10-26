#!/bin/bash
# `--allow-env` must be unrestricted: the `debug` package (dependency of
# @slack/web-api) calls Object.keys(process.env) at import time.
deno run \
  --allow-net=slack.com,openrouter.ai,github.com \
  --allow-env \
  --allow-sys=osRelease \
  --env \
  main.ts
