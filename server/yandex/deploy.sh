#!/usr/bin/env bash
# Загрузка новой версии функции tc-school-api в Yandex Cloud.
# Нужен yc (yc init уже выполнен). Среда Yandex ищет index.js — копируем index.mjs под этим именем.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
YC="${YC:-yc}"
SA_NAME="${SA_NAME:-tc-school}"
BUCKET="${BUCKET:-tc-school-k87}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/handler.mjs" "$tmp/handler.mjs"
cp "$here/index.mjs" "$tmp/index.js"
printf '{ "type": "module" }\n' > "$tmp/package.json"
sa_id="$("$YC" iam service-account get "$SA_NAME" --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
"$YC" serverless function version create \
  --function-name tc-school-api --runtime nodejs22 --entrypoint index.handler \
  --memory 128m --execution-timeout 10s --source-path "$tmp" \
  --service-account-id "$sa_id" --environment "BUCKET=$BUCKET"
"$YC" serverless function get tc-school-api --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('Адрес:', JSON.parse(s).http_invoke_url))"
