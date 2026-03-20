import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const ENV_PATH = path.join(ROOT_DIR, ".env");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "space-track-skor-current-payloads.csv");
const LOGIN_URL = "https://www.space-track.org/ajaxauth/login";
const QUERY_PATH = [
  "/basicspacedata/query/class/satcat",
  "COUNTRY/SKOR",
  "CURRENT/Y",
  "OBJECT_TYPE/PAYLOAD",
  "orderby/LAUNCH asc",
  "format/json",
].join("/");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function assertCredentials() {
  const identity = process.env.SPACE_TRACK_IDENTITY?.trim();
  const password = process.env.SPACE_TRACK_PASSWORD?.trim();

  if (!identity || !password) {
    throw new Error("SPACE_TRACK_IDENTITY 또는 SPACE_TRACK_PASSWORD가 비어 있습니다.");
  }

  return { identity, password };
}

function readCookie(response) {
  const cookie = response.headers.get("set-cookie");
  return cookie ? cookie.split(";", 1)[0] : "";
}

async function login(identity, password) {
  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "temp-pltr/space-track-export",
    },
    body: new URLSearchParams({ identity, password }),
    signal: AbortSignal.timeout(40_000),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Space-Track login failed with ${response.status}: ${details.slice(0, 200)}`);
  }

  const cookie = readCookie(response);
  if (!cookie) {
    throw new Error("Space-Track session cookie was not returned.");
  }

  return cookie;
}

async function fetchSatcat(cookie) {
  const response = await fetch(`https://www.space-track.org${QUERY_PATH}`, {
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      "User-Agent": "temp-pltr/space-track-export",
    },
    signal: AbortSignal.timeout(40_000),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Space-Track query failed with ${response.status}: ${details.slice(0, 200)}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Space-Track payload is not an array.");
  }

  return payload;
}

function escapeCsvValue(value) {
  const normalized = value == null ? "" : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replaceAll("\"", "\"\"")}"`;
  }

  return normalized;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  loadDotEnv(ENV_PATH);
  const { identity, password } = assertCredentials();
  const cookie = await login(identity, password);
  const payload = await fetchSatcat(cookie);

  const headers = [
    "NORAD_CAT_ID",
    "OBJECT_NAME",
    "SATNAME",
    "OBJECT_ID",
    "COUNTRY",
    "OBJECT_TYPE",
    "CURRENT",
    "LAUNCH",
    "SITE",
    "PERIOD",
    "INCLINATION",
    "APOGEE",
    "PERIGEE",
    "RCS_SIZE",
    "LAUNCH_YEAR",
    "LAUNCH_NUM",
    "LAUNCH_PIECE",
    "FILE",
  ];

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, toCsv(payload, headers), "utf8");

  console.log(
    JSON.stringify(
      {
        saved: OUTPUT_PATH,
        count: payload.length,
        criteria: "class=satcat, COUNTRY=SKOR, CURRENT=Y, OBJECT_TYPE=PAYLOAD",
      },
      null,
      2,
    ),
  );
}

await main();
