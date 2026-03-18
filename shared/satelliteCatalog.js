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

export const satelliteCatalog = [
  {
    id: "spaceeye-t",
    name: "SpaceEye-T",
    domesticName: "SpaceEye-T",
    color: "#ff9059",
    norad: "63229",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 광학 지구관측",
    operationalStatus: "운용 중",
  },
  {
    id: "kompsat-2",
    name: "KOMPSAT-2",
    domesticName: "아리랑위성 2호",
    color: "#ffd166",
    norad: "29268",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  {
    id: "kompsat-3",
    name: "KOMPSAT-3",
    domesticName: "아리랑위성 3호",
    color: "#7bdff2",
    norad: "38338",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  {
    id: "kompsat-3a",
    name: "KOMPSAT-3A",
    domesticName: "아리랑위성 3A호",
    color: "#f78fb3",
    norad: "40536",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  {
    id: "kompsat-5",
    name: "KOMPSAT-5",
    domesticName: "아리랑위성 5호",
    color: "#9bdeac",
    norad: "39227",
    orbitClass: "leo",
    orbitLabel: "LEO SSO",
    missionType: "earth-observation",
    missionLabel: "상업 지구관측",
    operationalStatus: "운용 중",
  },
  {
    id: "koreasat-5a",
    name: "KOREASAT 5A",
    domesticName: "무궁화 5A호",
    color: "#8bd0ff",
    norad: "42984",
    orbitClass: "geo",
    orbitLabel: "GEO",
    missionType: "communications",
    missionLabel: "상업 통신",
    operationalStatus: "운용 중",
    orbitalSlot: "113°E",
  },
  {
    id: "koreasat-6a",
    name: "KOREASAT 6A",
    domesticName: "무궁화 6A호",
    color: "#65d4a8",
    norad: "61910",
    orbitClass: "geo",
    orbitLabel: "GEO",
    missionType: "communications",
    missionLabel: "상업 통신",
    operationalStatus: "운용 중",
    orbitalSlot: "116°E",
  },
];

export const snapshotOrbitFleet = [
  {
    ...satelliteCatalog[0],
    sourceDate: "2026-02-09",
    sourceLabel: "Snapshot OMM",
    omm: {
      OBJECT_NAME: "SPACEEYE-T1",
      OBJECT_ID: "2025-052V",
      EPOCH: "2026-02-08T15:40:43.523328",
      MEAN_MOTION: 15.21127898,
      ECCENTRICITY: 0.0003383,
      INCLINATION: 97.4106,
      RA_OF_ASC_NODE: 294.2615,
      ARG_OF_PERICENTER: 229.8433,
      MEAN_ANOMALY: 130.2507,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: 63229,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 5029,
      BSTAR: 0.00028051,
      MEAN_MOTION_DOT: 6.176e-5,
      MEAN_MOTION_DDOT: 0,
    },
  },
  {
    ...satelliteCatalog[1],
    sourceDate: "2026-02-09",
    sourceLabel: "Snapshot TLE",
    tle: [
      "1 29268U 06031A   26040.61168774  .00000383  00000-0  80480-4 0  9997",
      "2 29268  97.8285 231.2221 0015612 115.9084 336.5398 14.64562596 42803",
    ],
  },
  {
    ...satelliteCatalog[2],
    sourceDate: "2026-02-09",
    sourceLabel: "Snapshot OMM",
    omm: {
      OBJECT_NAME: "ARIRANG-3 (KOMPSAT-3)",
      OBJECT_ID: "2012-025B",
      EPOCH: "2026-02-08T22:11:09.731616",
      MEAN_MOTION: 14.61974694,
      ECCENTRICITY: 0.00065694,
      INCLINATION: 98.1793,
      RA_OF_ASC_NODE: 359.6244,
      ARG_OF_PERICENTER: 145.3518,
      MEAN_ANOMALY: 214.8113,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: 38338,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 73260,
      BSTAR: 0.00014227634,
      MEAN_MOTION_DOT: 6.66e-6,
      MEAN_MOTION_DDOT: 0,
    },
  },
  {
    ...satelliteCatalog[3],
    sourceDate: "2026-02-11",
    sourceLabel: "Snapshot OMM",
    omm: {
      OBJECT_NAME: "KOMPSAT-3A",
      OBJECT_ID: "2015-014A",
      EPOCH: "2026-02-10T13:46:14.548800",
      MEAN_MOTION: 15.4729339,
      ECCENTRICITY: 0.00625563,
      INCLINATION: 97.6837,
      RA_OF_ASC_NODE: 24.3707,
      ARG_OF_PERICENTER: 278.2325,
      MEAN_ANOMALY: 81.1833,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: 40536,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 60219,
      BSTAR: 0.00047949051,
      MEAN_MOTION_DOT: 0.00026358,
      MEAN_MOTION_DDOT: 0,
    },
  },
  {
    ...satelliteCatalog[4],
    sourceDate: "2025-09-15",
    sourceLabel: "Snapshot TLE",
    tle: [
      "1 39227U 13042A 25257.75489962 -.00000384 00000+0 -23154-4 0 9999",
      "2 39227 97.6209 83.3010 0002888 26.8203 333.3172 15.04498290662446",
    ],
  },
  {
    ...satelliteCatalog[5],
    sourceDate: "2025-12-23",
    sourceLabel: "Snapshot OMM",
    omm: {
      OBJECT_NAME: "KOREASAT 5A",
      OBJECT_ID: "2017-067A",
      EPOCH: "2025-12-22T11:59:31.164000",
      MEAN_MOTION: 1.00271483,
      ECCENTRICITY: 0.00012014,
      INCLINATION: 0.011,
      RA_OF_ASC_NODE: 331.5207,
      ARG_OF_PERICENTER: 273.577,
      MEAN_ANOMALY: 139.2416,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: 42984,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 2975,
      BSTAR: 0,
      MEAN_MOTION_DOT: -3.36e-6,
      MEAN_MOTION_DDOT: 0,
    },
  },
  {
    ...satelliteCatalog[6],
    sourceDate: "2026-01-27",
    sourceLabel: "Snapshot OMM",
    omm: {
      OBJECT_NAME: "KOREASAT 6A",
      OBJECT_ID: "2024-206A",
      EPOCH: "2026-01-26T17:40:38.735616",
      MEAN_MOTION: 1.00272177,
      ECCENTRICITY: 0.0001103,
      INCLINATION: 0.0114,
      RA_OF_ASC_NODE: 138.547,
      ARG_OF_PERICENTER: 144.3373,
      MEAN_ANOMALY: 224.2943,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: 61910,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 442,
      BSTAR: 0,
      MEAN_MOTION_DOT: -3.5e-6,
      MEAN_MOTION_DDOT: 0,
    },
  },
];

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
