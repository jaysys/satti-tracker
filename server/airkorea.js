const AIRKOREA_SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY?.trim() ?? "";
const AIRKOREA_REALTIME_URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
const AIRKOREA_CACHE_TTL_MS = 10 * 60 * 1000;
const SIDO_NAMES = [
  "서울",
  "경기",
  "인천",
  "강원",
  "충북",
  "충남",
  "세종",
  "대전",
  "전북",
  "광주",
  "전남",
  "경북",
  "대구",
  "울산",
  "경남",
  "부산",
  "제주",
];

let dashboardCache = {
  fetchedAt: null,
  payload: null,
};

function isFresh(timestamp) {
  return timestamp && Date.now() - new Date(timestamp).getTime() < AIRKOREA_CACHE_TTL_MS;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-" || value === "null") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function fetchRealtimeBySido(sidoName) {
  const candidateKeys = [
    AIRKOREA_SERVICE_KEY,
    (() => {
      try {
        return decodeURIComponent(AIRKOREA_SERVICE_KEY);
      } catch {
        return AIRKOREA_SERVICE_KEY;
      }
    })(),
    encodeURIComponent(AIRKOREA_SERVICE_KEY),
  ].filter((value, index, list) => value && list.indexOf(value) === index);

  let lastError = null;

  for (const candidateKey of candidateKeys) {
    const query = new URLSearchParams({
      serviceKey: candidateKey,
      returnType: "json",
      numOfRows: "200",
      pageNo: "1",
      sidoName,
      ver: "1.0",
    });

    const response = await fetch(`${AIRKOREA_REALTIME_URL}?${query.toString()}`);
    if (response.ok) {
      const payload = await response.json();
      const items = payload?.response?.body?.items;

      if (!Array.isArray(items)) {
        throw new Error("AirKorea payload did not include items.");
      }

      return items;
    }

    if (response.status === 401) {
      lastError = new Error("AirKorea rejected DATA_GO_KR_SERVICE_KEY. Check the approved encoding/decoding key.");
      continue;
    }

    lastError = new Error(`AirKorea request failed with ${response.status}`);
    break;
  }

  throw lastError ?? new Error("AirKorea request failed.");
}

function buildDashboardPayload(items) {
  const normalized = items.map((item) => ({
    sidoName: item.sidoName,
    stationName: item.stationName,
    dataTime: item.dataTime,
    khaiGrade: toNumber(item.khaiGrade),
    pm10Value: toNumber(item.pm10Value),
    pm25Value: toNumber(item.pm25Value),
    o3Value: toNumber(item.o3Value),
  }));

  const pm25Values = normalized.map((item) => item.pm25Value).filter(Number.isFinite);
  const pm10Values = normalized.map((item) => item.pm10Value).filter(Number.isFinite);
  const badStations = normalized.filter(
    (item) =>
      (Number.isFinite(item.pm25Value) && item.pm25Value >= 36) ||
      (Number.isFinite(item.pm10Value) && item.pm10Value >= 81) ||
      (Number.isFinite(item.khaiGrade) && item.khaiGrade >= 3),
  );
  const topPm25Stations = [...normalized]
    .filter((item) => Number.isFinite(item.pm25Value))
    .sort((left, right) => right.pm25Value - left.pm25Value)
    .slice(0, 10);

  const bySido = SIDO_NAMES.map((sidoName) => {
    const rows = normalized.filter((item) => item.sidoName === sidoName);
    const pm25Average = average(rows.map((item) => item.pm25Value).filter(Number.isFinite));
    const pm10Average = average(rows.map((item) => item.pm10Value).filter(Number.isFinite));

    return {
      sidoName,
      stationCount: rows.length,
      pm25Average: Number.isFinite(pm25Average) ? Math.round(pm25Average) : null,
      pm10Average: Number.isFinite(pm10Average) ? Math.round(pm10Average) : null,
    };
  })
    .filter((item) => item.stationCount > 0)
    .sort((left, right) => (right.pm25Average ?? -Infinity) - (left.pm25Average ?? -Infinity));

  const updatedAt = normalized.map((item) => item.dataTime).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    provider: "data.go.kr AirKorea realtime",
    fetchedAt: new Date().toISOString(),
    updatedAt,
    cachePolicy: "Ctprvn realtime cache 10m",
    summary: {
      stationCount: normalized.length,
      pm25Average: Number.isFinite(average(pm25Values)) ? Math.round(average(pm25Values)) : null,
      pm10Average: Number.isFinite(average(pm10Values)) ? Math.round(average(pm10Values)) : null,
      badStationCount: badStations.length,
    },
    topPm25Stations,
    bySido,
  };
}

export async function getAirkoreaDashboard() {
  if (!AIRKOREA_SERVICE_KEY) {
    return {
      provider: "AirKorea unavailable",
      fetchedAt: null,
      updatedAt: null,
      cachePolicy: "Set DATA_GO_KR_SERVICE_KEY in .env",
      warning: "DATA_GO_KR_SERVICE_KEY is missing.",
      summary: {
        stationCount: 0,
        pm25Average: null,
        pm10Average: null,
        badStationCount: 0,
      },
      topPm25Stations: [],
      bySido: [],
    };
  }

  if (dashboardCache.payload && isFresh(dashboardCache.fetchedAt)) {
    return dashboardCache.payload;
  }

  try {
    const responses = await Promise.all(SIDO_NAMES.map((sidoName) => fetchRealtimeBySido(sidoName)));
    const payload = buildDashboardPayload(responses.flat());

    dashboardCache = {
      fetchedAt: payload.fetchedAt,
      payload,
    };

    return payload;
  } catch (error) {
    return {
      provider: "AirKorea unavailable",
      fetchedAt: null,
      updatedAt: null,
      cachePolicy: "Check DATA_GO_KR_SERVICE_KEY approval and key type",
      warning: error.message,
      summary: {
        stationCount: 0,
        pm25Average: null,
        pm10Average: null,
        badStationCount: 0,
      },
      topPm25Stations: [],
      bySido: [],
    };
  }
}
