#!/usr/bin/env bash
# Запускает команду в CI; при ошибке выносит хвост лога в аннотацию,
# которую видно на странице сборки даже без входа на GitHub.
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  out=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | tail -n 60 | tail -c 6000)
  out="${out//'%'/'%25'}"
  out="${out//$'\r'/'%0D'}"
  out="${out//$'\n'/'%0A'}"
  echo "::error title=$* (код $status)::$out"
fi
exit "$status"
