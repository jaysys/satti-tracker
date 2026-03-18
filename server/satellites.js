import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as satellite from "satellite.js";
import {
  buildFleetEntry,
  isoToDateStamp,
  normalizeOmm,
  satelliteCatalog,
  snapshotOrbitFleet,
} from "../shared/satelliteCatalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const persistedFleetCachePath = path.join(__dirname, "..", "data", "satellite-live-cache.json");
const persistedLeoCachePath = path.join(__dirname, "..", "data", "leo-live-cache.json");

const SPACE_TRACK_IDENTITY = process.env.SPACE_TRACK_IDENTITY?.trim() ?? "";
const SPACE_TRACK_PASSWORD = process.env.SPACE_TRACK_PASSWORD?.trim() ?? "";

const LIVE_TIMEOUT_MS = 40 * 1000;
const CACHE_TTL_BY_ORBIT_MS = {
  leo: 30 * 60 * 1000,
  geo: 12 * 60 * 60 * 1000,
};
const LEO_GP_REFRESH_MS = 60 * 60 * 1000;
const LEO_POINT_SNAPSHOT_MS = 10 * 1000;
const LEO_MEAN_MOTION_MIN = 11.25;
const KOREAN_NORADS = new Set(satelliteCatalog.map((item) => item.norad));

const liveCache = new Map(loadPersistedFleetCache());
let leoPopulationCache = loadPersistedLeoCache();
let leoPointSnapshot = {
  generatedAt: null,
  fetchedAt: null,
  points: [],
  totalCount: 0,
  renderedCount: 0,
  sourceState: "snapshot",
};
let spaceTrackSessionPromise = null;

function loadPersistedFleetCache() {
  try {
    if (!fs.existsSync(persistedFleetCachePath)) {
      return [];
    }

    const raw = JSON.parse(fs.readFileSync(persistedFleetCachePath, "utf8"));
    if (!raw?.entries || typeof raw.entries !== "object") {
      return [];
    }

    return Object.entries(raw.entries).map(([id, entry]) => [id, entry]);
  } catch {
    return [];
  }
}

function persistFleetCache() {
  fs.writeFileSync(
    persistedFleetCachePath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        entries: Object.fromEntries(liveCache.entries()),
      },
      null,
      2,
    ),
  );
}

function compileLeoRecords(records) {
  return records
    .map((record) => {
      try {
        const omm = normalizeOmm(record.omm);
        return {
          ...record,
          omm,
          satrec: satellite.json2satrec(omm),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadPersistedLeoCache() {
  try {
    if (!fs.existsSync(persistedLeoCachePath)) {
      return { fetchedAt: null, records: [], compiled: [] };
    }

    const raw = JSON.parse(fs.readFileSync(persistedLeoCachePath, "utf8"));
    const records = Array.isArray(raw?.entries) ? raw.entries : [];

    return {
      fetchedAt: raw?.fetchedAt ?? null,
      records,
      compiled: compileLeoRecords(records),
    };
  } catch {
    return { fetchedAt: null, records: [], compiled: [] };
  }
}

function persistLeoCache() {
  fs.writeFileSync(
    persistedLeoCachePath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        fetchedAt: leoPopulationCache.fetchedAt,
        entries: leoPopulationCache.records,
      },
      null,
      2,
    ),
  );
}

function cloneFleetEntry(item) {
  return {
    ...item,
    omm: item.omm ? { ...item.omm } : undefined,
    tle: item.tle ? [...item.tle] : undefined,
  };
}

function cloneFleet(fleet) {
  return fleet.map(cloneFleetEntry);
}

function getSnapshotFallback(base) {
  const snapshot = snapshotOrbitFleet.find((item) => item.id === base.id);
  return snapshot
    ? {
        ...cloneFleetEntry(snapshot),
        sourceLabel: "Snapshot fallback",
        sourceState: "snapshot",
      }
    : null;
}

function getCacheTtlMs(base) {
  return CACHE_TTL_BY_ORBIT_MS[base.orbitClass] ?? CACHE_TTL_BY_ORBIT_MS.leo;
}

function isFreshTimestamp(updatedAt, ttlMs) {
  if (!updatedAt) {
    return false;
  }

  return Date.now() - new Date(updatedAt).getTime() < ttlMs;
}

function isFresh(base, cachedEntry) {
  return isFreshTimestamp(cachedEntry?.fetchedAt, getCacheTtlMs(base));
}

function formatAge(updatedAt) {
  if (!updatedAt) {
    return "unknown";
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function readCookies(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  if (getSetCookie) {
    return getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }

  const singleCookie = response.headers.get("set-cookie");
  return singleCookie ? singleCookie.split(";", 1)[0] : "";
}

async function createSpaceTrackSession() {
  if (!SPACE_TRACK_IDENTITY || !SPACE_TRACK_PASSWORD) {
    throw new Error("SPACE_TRACK_IDENTITY 또는 SPACE_TRACK_PASSWORD가 비어 있습니다.");
  }

  if (spaceTrackSessionPromise) {
    return spaceTrackSessionPromise;
  }

  spaceTrackSessionPromise = fetch("https://www.space-track.org/ajaxauth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "PulseDesk/0.1 satellite-tracker",
    },
    body: new URLSearchParams({
      identity: SPACE_TRACK_IDENTITY,
      password: SPACE_TRACK_PASSWORD,
    }),
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Space-Track login failed with ${response.status}`);
      }

      const cookieHeader = readCookies(response);
      if (!cookieHeader) {
        throw new Error("Space-Track session cookie was not returned.");
      }

      return cookieHeader;
    })
    .finally(() => {
      spaceTrackSessionPromise = null;
    });

  return spaceTrackSessionPromise;
}

async function fetchSpaceTrackJson(pathname) {
  const cookieHeader = await createSpaceTrackSession();
  const response = await fetch(`https://www.space-track.org${pathname}`, {
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
      "User-Agent": "PulseDesk/0.1 satellite-tracker",
    },
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Space-Track query failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Space-Track payload is not an array.");
  }

  return payload;
}

async function fetchSpaceTrackFleet() {
  const noradList = satelliteCatalog.map((item) => item.norad).join(",");
  const payload = await fetchSpaceTrackJson(
    [
      "/basicspacedata/query/class/gp",
      `NORAD_CAT_ID/${noradList}`,
      "orderby/NORAD_CAT_ID",
      "format/json",
    ].join("/"),
  );

  const byNorad = new Map(payload.map((entry) => [String(entry.NORAD_CAT_ID), entry]));

  for (const base of satelliteCatalog) {
    const omm = byNorad.get(base.norad);
    if (!omm) {
      continue;
    }

    liveCache.set(base.id, {
      fetchedAt: new Date().toISOString(),
      fleetEntry: buildFleetEntry(base, omm, {
        sourceLabel: "Space-Track cached GP",
      }),
    });
  }

  persistFleetCache();
}

async function refreshSpaceTrackFleet() {
  try {
    await fetchSpaceTrackFleet();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await fetchSpaceTrackFleet().catch(() => {
      throw error;
    });
  }
}

function buildResolvedEntry(base) {
  const cachedEntry = liveCache.get(base.id);

  if (cachedEntry && isFresh(base, cachedEntry)) {
    return {
      fleetEntry: {
        ...cloneFleetEntry(cachedEntry.fleetEntry),
        sourceState: "cached",
      },
      fetchedAt: cachedEntry.fetchedAt,
      state: "fresh-cache",
      warning: "",
    };
  }

  if (cachedEntry) {
    return {
      fleetEntry: {
        ...cloneFleetEntry(cachedEntry.fleetEntry),
        sourceLabel: "Stale cached GP",
        sourceState: "stale",
      },
      fetchedAt: cachedEntry.fetchedAt,
      state: "stale-cache",
      warning: `${base.name}: stale cache reused`,
    };
  }

  const fallback = getSnapshotFallback(base);
  if (fallback) {
    return {
      fleetEntry: fallback,
      fetchedAt: null,
      state: "snapshot-fallback",
      warning: `${base.name}: snapshot fallback`,
    };
  }

  return {
    fleetEntry: {
      ...base,
      sourceDate: null,
      sourceLabel: "No data available",
      sourceState: "snapshot",
    },
    fetchedAt: null,
    state: "missing",
    warning: `${base.name}: no cache available`,
  };
}

function buildLiveMeta(resolvedEntries) {
  const updatedAtValues = resolvedEntries
    .map((entry) => entry.fetchedAt)
    .filter(Boolean)
    .sort()
    .reverse();

  const usesFallback = resolvedEntries.some(
    (entry) => entry.state === "stale-cache" || entry.state === "snapshot-fallback" || entry.state === "missing",
  );
  const warnings = resolvedEntries
    .map((entry) => entry.warning)
    .filter(Boolean);

  return {
    updatedAt: updatedAtValues[0] ?? null,
    freshnessLabel: updatedAtValues[0] ? formatAge(updatedAtValues[0]) : "snapshot only",
    isFallback: usesFallback,
    warning: warnings.length > 0 ? warnings.join(" / ") : "",
    cachePolicy: "Korea: LEO 30m · GEO 12h",
  };
}

function normalizeLeoRecord(entry) {
  const norad = String(entry.NORAD_CAT_ID ?? "").trim();
  if (!norad || KOREAN_NORADS.has(norad)) {
    return null;
  }

  const omm = normalizeOmm(entry);
  const objectType = String(entry.OBJECT_TYPE ?? "").toUpperCase();
  if (objectType && objectType !== "PAYLOAD") {
    return null;
  }

  if (!Number.isFinite(omm.MEAN_MOTION) || omm.MEAN_MOTION <= LEO_MEAN_MOTION_MIN) {
    return null;
  }

  return {
    norad,
    name: String(entry.OBJECT_NAME ?? `NORAD ${norad}`),
    sourceDate: isoToDateStamp(omm.EPOCH),
    sourceState: "cached",
    omm,
  };
}

async function fetchLeoPopulationFromSpaceTrack() {
  const payload = await fetchSpaceTrackJson(
    [
      "/basicspacedata/query/class/gp",
      "DECAY_DATE/null-val",
      "EPOCH/%3Enow-30",
      `MEAN_MOTION/%3E${LEO_MEAN_MOTION_MIN}`,
      "predicates/OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT,OBJECT_TYPE,DECAY_DATE",
      "orderby/NORAD_CAT_ID",
      "format/json",
    ].join("/"),
  );

  const records = payload
    .map(normalizeLeoRecord)
    .filter(Boolean);

  if (records.length === 0) {
    throw new Error("Space-Track LEO payload query returned no active payloads.");
  }

  leoPopulationCache = {
    fetchedAt: new Date().toISOString(),
    records,
    compiled: compileLeoRecords(records),
  };
  leoPointSnapshot = {
    generatedAt: null,
    fetchedAt: leoPopulationCache.fetchedAt,
    points: [],
    totalCount: 0,
    renderedCount: 0,
    sourceState: "cached",
  };
  persistLeoCache();
}

async function refreshLeoPopulation() {
  try {
    await fetchLeoPopulationFromSpaceTrack();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await fetchLeoPopulationFromSpaceTrack().catch(() => {
      throw error;
    });
  }
}

function isLeoPopulationFresh() {
  return isFreshTimestamp(leoPopulationCache.fetchedAt, LEO_GP_REFRESH_MS);
}

function computePointState(satrec, date) {
  const propagated = satellite.propagate(satrec, date);
  if (!propagated?.position) {
    return null;
  }

  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(propagated.position, gmst);

  return {
    latitude: satellite.degreesLat(geodetic.latitude),
    longitude: satellite.degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
  };
}

function buildLeoPointSnapshot(sourceState) {
  const now = new Date();
  const points = [];

  for (const record of leoPopulationCache.compiled) {
    const state = computePointState(record.satrec, now);
    if (!state) {
      continue;
    }

    points.push({
      norad: record.norad,
      name: record.name,
      latitude: Number(state.latitude.toFixed(4)),
      longitude: Number(state.longitude.toFixed(4)),
      altitudeKm: Math.round(state.altitudeKm),
      sourceDate: record.sourceDate,
      sourceState,
    });
  }

  leoPointSnapshot = {
    generatedAt: now.toISOString(),
    fetchedAt: leoPopulationCache.fetchedAt,
    points,
    totalCount: leoPopulationCache.records.length,
    renderedCount: points.length,
    sourceState,
  };

  return leoPointSnapshot;
}

function getLeoPointSourceState(fetchError) {
  if (leoPopulationCache.records.length === 0) {
    return "snapshot";
  }

  if (fetchError || !isLeoPopulationFresh()) {
    return "stale";
  }

  return "cached";
}

export async function getSatelliteFleet(mode = "snapshot") {
  if (mode !== "live") {
    return {
      mode: "snapshot",
      provider: "Bundled snapshot",
      isFallback: false,
      warning: "",
      updatedAt: null,
      freshnessLabel: "bundled",
      cachePolicy: "Static snapshot",
      fleet: cloneFleet(snapshotOrbitFleet).map((item) => ({
        ...item,
        sourceState: "snapshot",
      })),
    };
  }

  let fetchError = "";

  try {
    await refreshSpaceTrackFleet();
  } catch (error) {
    fetchError = error.message;
  }

  const resolvedEntries = satelliteCatalog.map(buildResolvedEntry);
  const fleet = resolvedEntries.map((entry) => entry.fleetEntry);
  const meta = buildLiveMeta(resolvedEntries);

  return {
    mode: "live",
    provider: "Space-Track cached GP",
    isFallback: meta.isFallback,
    warning: fetchError ? `${fetchError} / ${meta.warning}` : meta.warning,
    updatedAt: meta.updatedAt,
    freshnessLabel: meta.freshnessLabel,
    cachePolicy: meta.cachePolicy,
    fleet,
  };
}

export async function getLeoBackdrop(mode = "snapshot") {
  if (mode !== "live") {
    return {
      mode: "snapshot",
      provider: "LEO overlay disabled",
      warning: "",
      updatedAt: null,
      generatedAt: null,
      freshnessLabel: "off",
      cachePolicy: "Enable latest cache mode",
      totalCount: 0,
      renderedCount: 0,
      sourceState: "snapshot",
      points: [],
    };
  }

  let fetchError = "";

  if (!isLeoPopulationFresh()) {
    try {
      await refreshLeoPopulation();
    } catch (error) {
      fetchError = error.message;
    }
  }

  const sourceState = getLeoPointSourceState(fetchError);
  const isPointSnapshotFresh =
    leoPointSnapshot.fetchedAt === leoPopulationCache.fetchedAt &&
    isFreshTimestamp(leoPointSnapshot.generatedAt, LEO_POINT_SNAPSHOT_MS);
  const snapshot = isPointSnapshotFresh ? leoPointSnapshot : buildLeoPointSnapshot(sourceState);

  return {
    mode: "live",
    provider: "Space-Track LEO backdrop",
    warning: fetchError,
    updatedAt: leoPopulationCache.fetchedAt,
    generatedAt: snapshot.generatedAt,
    freshnessLabel: leoPopulationCache.fetchedAt ? formatAge(leoPopulationCache.fetchedAt) : "unavailable",
    cachePolicy: "GP refresh 60m · point snapshot 10s",
    totalCount: snapshot.totalCount,
    renderedCount: snapshot.renderedCount,
    sourceState,
    points: snapshot.points,
  };
}
