import liveFleetCache from "../data/satellite-live-cache.json" with { type: "json" };
import { listSatelliteCatalogRows } from "../server/db.js";

const numericOmmFields = [
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "EPHEMERIS_TYPE",
  "NORAD_CAT_ID",
  "ELEMENT_SET_NO",
  "REV_AT_EPOCH",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
];

const orbitColors = {
  leo: ["#ff9059", "#ffd166", "#7bdff2", "#f78fb3", "#9bdeac", "#8bd0ff", "#79c6a5", "#f6bd60"],
  geo: ["#65d4a8", "#8bd0ff", "#f1a66a", "#e98fb0", "#c7ceea", "#9ad1d4"],
  meo: ["#d7a9ff", "#a0c4ff", "#caffbf", "#fdffb6"],
  cislunar: ["#f7b267", "#f79d65", "#f4845f", "#f27059"],
};

const manualOverrides = {
  "29268": {
    id: "kompsat-2",
    domesticName: "아리랑위성 2호",
    color: "#ffd166",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  "38338": {
    id: "kompsat-3",
    domesticName: "아리랑위성 3호",
    color: "#7bdff2",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  "39227": {
    id: "kompsat-5",
    domesticName: "아리랑위성 5호",
    color: "#9bdeac",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  "40536": {
    id: "kompsat-3a",
    domesticName: "아리랑위성 3A호",
    color: "#f78fb3",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  "42984": {
    id: "koreasat-5a",
    domesticName: "무궁화 5A호",
    color: "#8bd0ff",
    orbitClass: "geo",
    orbitLabel: "GEO",
    missionType: "communications",
    missionLabel: "상업 통신",
    operationalStatus: "운용 중",
    orbitalSlot: "113°E",
  },
  "61910": {
    id: "koreasat-6a",
    domesticName: "무궁화 6A호",
    color: "#65d4a8",
    orbitClass: "geo",
    orbitLabel: "GEO",
    missionType: "communications",
    missionLabel: "상업 통신",
    operationalStatus: "운용 중",
    orbitalSlot: "116°E",
  },
  "63229": {
    id: "spaceeye-t",
    name: "SpaceEye-T",
    domesticName: "SpaceEye-T",
    color: "#ff9059",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 광학 지구관측",
    operationalStatus: "운용 중",
  },
};

const activeOperationalNorads = new Set([
  "29268", // KOMPSAT-2
  "38338", // KOMPSAT-3
  "39227", // KOMPSAT-5
  "40536", // KOMPSAT-3A
  "42691", // KOREASAT 7
  "42984", // KOREASAT 5A
  "61910", // KOREASAT 6A
  "63229", // SpaceEye-T
]);

const decayedNorads = new Set(
  Object.values(liveFleetCache.entries ?? {})
    .map((entry) => entry?.fleetEntry)
    .filter((entry) => entry?.omm?.DECAY_DATE)
    .map((entry) => String(entry.norad)),
);

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashValue(value) {
  return String(value).split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function inferOrbit(row) {
  const period = toNumber(row.PERIOD);
  const apogee = toNumber(row.APOGEE);
  const inclination = toNumber(row.INCLINATION);
  const name = String(row.OBJECT_NAME ?? "").toUpperCase();

  if (name === "KPLO") {
    return { orbitClass: "cislunar", orbitLabel: "Lunar orbit" };
  }

  if ((period && period >= 1300) || (apogee && apogee >= 30000)) {
    return { orbitClass: "geo", orbitLabel: "GEO" };
  }

  if ((period && period >= 200) || (apogee && apogee >= 2000)) {
    return { orbitClass: "meo", orbitLabel: "MEO" };
  }

  if (inclination && inclination > 90) {
    return { orbitClass: "leo", orbitLabel: "LEO SSO" };
  }

  return { orbitClass: "leo", orbitLabel: "LEO" };
}

function inferMission(row) {
  const name = `${row.OBJECT_NAME ?? ""} ${row.SATNAME ?? ""}`.toUpperCase();

  if (/KOREASAT|MUGUNGHWA/.test(name)) {
    return { missionType: "communications", missionLabel: "상업 통신" };
  }

  if (/GEO-KOMPSAT|COMS/.test(name)) {
    return { missionType: "earth-observation", missionLabel: "기상·해양 관측" };
  }

  if (/SPACEEYE|KOMPSAT|CAS500|NEONSAT|OBSERVER|KORSAT|GYEONGGISAT/.test(name)) {
    return { missionType: "earth-observation", missionLabel: "지구관측" };
  }

  if (/KPLO/.test(name)) {
    return { missionType: "science", missionLabel: "심우주 탐사" };
  }

  return { missionType: "technology", missionLabel: "기술실증/학술" };
}

function inferColor(norad, orbitClass) {
  const palette = orbitColors[orbitClass] ?? orbitColors.leo;
  return palette[hashValue(norad) % palette.length];
}

function buildCatalogEntry(row) {
  const override = manualOverrides[row.NORAD_CAT_ID] ?? {};
  const orbit = inferOrbit(row);
  const mission = inferMission(row);
  const englishName = row.OBJECT_NAME ?? row.SATNAME ?? `NORAD ${row.NORAD_CAT_ID}`;
  const name = override.name ?? englishName;

  return {
    id: override.id ?? `${slugify(name)}-${row.NORAD_CAT_ID}`,
    name,
    englishName,
    domesticName: override.domesticName ?? name,
    color: override.color ?? inferColor(row.NORAD_CAT_ID, override.orbitClass ?? orbit.orbitClass),
    norad: row.NORAD_CAT_ID,
    orbitClass: override.orbitClass ?? orbit.orbitClass,
    orbitLabel: override.orbitLabel ?? orbit.orbitLabel,
    missionType: override.missionType ?? mission.missionType,
    missionLabel: override.missionLabel ?? mission.missionLabel,
    operationalStatus: override.operationalStatus ?? (activeOperationalNorads.has(row.NORAD_CAT_ID) ? "운용 중" : "비현역"),
    orbitalSlot: override.orbitalSlot,
    objectId: row.OBJECT_ID,
    launchDate: row.LAUNCH || null,
  };
}

const parsedCatalogRows = listSatelliteCatalogRows();

export const satelliteCatalogRows = parsedCatalogRows.map((row) => ({ ...row }));
export const satelliteCatalogAll = satelliteCatalogRows.map(buildCatalogEntry);
export const satelliteCatalog = satelliteCatalogAll.filter((entry) => !decayedNorads.has(entry.norad));

const snapshotFleetEntries = Object.values(liveFleetCache.entries ?? {})
  .map((entry) => entry?.fleetEntry)
  .filter((entry) => entry && !decayedNorads.has(String(entry.norad)));

const snapshotByNorad = new Map(snapshotFleetEntries.map((entry) => [String(entry.norad), entry]));

export const snapshotOrbitFleet = satelliteCatalog.map((catalogEntry) => {
  const snapshot = snapshotByNorad.get(catalogEntry.norad);

  if (!snapshot) {
    return {
      ...catalogEntry,
      sourceDate: null,
      sourceLabel: "Bundled catalog only",
      sourceState: "snapshot",
    };
  }

  return {
    ...catalogEntry,
    ...snapshot,
    sourceLabel: "Bundled cached GP",
    sourceState: "snapshot",
  };
});

export function normalizeOmm(omm) {
  const normalized = { ...omm };

  for (const field of numericOmmFields) {
    if (normalized[field] !== undefined && normalized[field] !== null && normalized[field] !== "") {
      normalized[field] = Number(normalized[field]);
    }
  }

  return normalized;
}

export function isoToDateStamp(value) {
  if (!value) {
    return "unknown";
  }

  return String(value).slice(0, 10);
}

export function buildFleetEntry(base, omm, options = {}) {
  const normalizedOmm = normalizeOmm({
    ...omm,
    NORAD_CAT_ID: omm.NORAD_CAT_ID ?? base.norad,
  });

  return {
    ...base,
    sourceDate: options.sourceDate ?? isoToDateStamp(normalizedOmm.EPOCH),
    sourceLabel: options.sourceLabel ?? "Live API",
    omm: normalizedOmm,
  };
}
