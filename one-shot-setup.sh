#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

mkdir -p .run data

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "[setup] .env 파일을 .env.example 기준으로 생성했다."
fi

echo "[setup] npm install 실행"
npm install

echo "[setup] 완료"
echo "[setup] 프런트: http://127.0.0.1:6004"
echo "[setup] 백엔드: http://127.0.0.1:60041/api"
