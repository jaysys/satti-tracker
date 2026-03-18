#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_DIR="$ROOT_DIR/.run"
SERVER_PID_FILE="$RUN_DIR/server.pid"
CLIENT_PID_FILE="$RUN_DIR/client.pid"
SERVER_PORT=60041
CLIENT_PORT=6004

get_listener_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

stop_process() {
  local name="$1"
  local pid_file="$2"
  local port="$3"
  local pid=""

  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
  fi

  if [[ -z "$pid" ]]; then
    pid="$(get_listener_pid "$port" || true)"
  fi

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "[stop] $name 는 실행 중이 아니다."
    return 0
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    pid="$(get_listener_pid "$port" || true)"
    if [[ -z "$pid" ]]; then
      rm -f "$pid_file"
      echo "[stop] $name 는 이미 종료된 상태다."
      return 0
    fi
  fi

  echo "[stop] $name 종료 pid=$pid"
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "[stop] $name 종료 완료"
      return 0
    fi
    sleep 0.25
  done

  echo "[stop] $name 강제 종료"
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

stop_process "프런트" "$CLIENT_PID_FILE" "$CLIENT_PORT"
stop_process "백엔드" "$SERVER_PID_FILE" "$SERVER_PORT"

echo "[stop] 완료"
