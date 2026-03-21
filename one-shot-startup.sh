#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_DIR="$ROOT_DIR/.run"
SERVER_PID_FILE="$RUN_DIR/server.pid"
CLIENT_PID_FILE="$RUN_DIR/client.pid"
SERVER_LOG_FILE="$RUN_DIR/server.log"
CLIENT_LOG_FILE="$RUN_DIR/client.log"
SERVER_PORT=60041
CLIENT_PORT=6004

mkdir -p "$RUN_DIR"

is_running() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -z "$pid" ]]; then
    return 1
  fi

  kill -0 "$pid" 2>/dev/null
}

cleanup_stale_pid() {
  local pid_file="$1"

  if [[ -f "$pid_file" ]] && ! is_running "$pid_file"; then
    rm -f "$pid_file"
  fi
}

get_listener_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[startup] $name 준비 완료: $url"
      return 0
    fi
    sleep 1
  done

  echo "[startup] $name 확인 실패: $url"
  return 1
}

cleanup_stale_pid "$SERVER_PID_FILE"
cleanup_stale_pid "$CLIENT_PID_FILE"

if [[ ! -d node_modules ]]; then
  echo "[startup] node_modules 가 없다. 먼저 ./one-shot-setup.sh 를 실행해라."
  exit 1
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "[startup] .env 파일을 .env.example 기준으로 생성했다."
fi

existing_server_pid="$(get_listener_pid "$SERVER_PORT" || true)"
existing_client_pid="$(get_listener_pid "$CLIENT_PORT" || true)"

if [[ -n "${existing_server_pid:-}" ]]; then
  echo "$existing_server_pid" >"$SERVER_PID_FILE"
  echo "[startup] 백엔드는 이미 실행 중이다. pid=$existing_server_pid"
else
  echo "[startup] 백엔드 기동"
  nohup perl -MPOSIX -e 'setsid() or die $!; exec @ARGV' \
    node --env-file-if-exists=.env server/index.js >"$SERVER_LOG_FILE" 2>&1 < /dev/null &
fi

if [[ -n "${existing_client_pid:-}" ]]; then
  echo "$existing_client_pid" >"$CLIENT_PID_FILE"
  echo "[startup] 프런트는 이미 실행 중이다. pid=$existing_client_pid"
else
  echo "[startup] 프런트 기동"
  nohup perl -MPOSIX -e 'setsid() or die $!; exec @ARGV' \
    ./node_modules/.bin/vite --host 127.0.0.1 --strictPort >"$CLIENT_LOG_FILE" 2>&1 < /dev/null &
fi

wait_for_http "http://127.0.0.1:60041/api/health" "백엔드"
wait_for_http "http://127.0.0.1:6004" "프런트"

server_pid="$(get_listener_pid "$SERVER_PORT" || true)"
client_pid="$(get_listener_pid "$CLIENT_PORT" || true)"

if [[ -z "${server_pid:-}" || -z "${client_pid:-}" ]]; then
  echo "[startup] 기동 후 리스너 PID를 확인하지 못했다."
  exit 1
fi

echo "$server_pid" >"$SERVER_PID_FILE"
echo "$client_pid" >"$CLIENT_PID_FILE"

echo "[startup] 완료"
echo "[startup] 프런트: http://127.0.0.1:6004"
echo "[startup] 백엔드: http://127.0.0.1:60041/api"
echo "[startup] 로그: $SERVER_LOG_FILE / $CLIENT_LOG_FILE"
