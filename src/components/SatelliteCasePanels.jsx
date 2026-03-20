import { Button, Card, HTMLTable, InputGroup, Intent, ProgressBar, Tag, Tooltip } from "@blueprintjs/core";
import { useEffect, useMemo, useState } from "react";
import { fetchLeoBackdrop, fetchSatelliteCatalogSummary, fetchSatelliteFleet } from "../api";
import CesiumOrbitDemo from "./CesiumOrbitDemo";

const ORBIT_SOURCE_MODE_STORAGE_KEY = "pulse-desk:orbit-source-mode";

const rasterLayers = [
  { name: "Cloud density", value: 0.76, tone: Intent.PRIMARY },
  { name: "Thermal anomaly", value: 0.48, tone: Intent.DANGER },
  { name: "Aerosol plume", value: 0.62, tone: Intent.WARNING },
  { name: "Ocean humidity", value: 0.55, tone: Intent.SUCCESS },
];

const rasterCells = [
  { region: "Korean Peninsula", signal: "High cloud mask", update: "14 sec ago" },
  { region: "East China Sea", signal: "Thermal gradient", update: "21 sec ago" },
  { region: "North Pacific", signal: "Aerosol spread", update: "35 sec ago" },
];

const networkRoutes = [
  { route: "Seoul -> Guam -> LEO-14", latency: "48 ms", capacity: "92%" },
  { route: "Tokyo -> GEO-A -> Sydney", latency: "72 ms", capacity: "81%" },
  { route: "Singapore -> LEO-08 -> Delhi", latency: "55 ms", capacity: "67%" },
];

const relayNodes = [
  { name: "Seoul Gateway", links: 14, severity: Intent.PRIMARY },
  { name: "Busan Maritime Relay", links: 8, severity: Intent.SUCCESS },
  { name: "Guam Deep Space Hub", links: 17, severity: Intent.DANGER },
  { name: "Tokyo Uplink Mesh", links: 11, severity: Intent.WARNING },
];

function PanelTitle({ eyebrow, title, tag }) {
  return (
    <div className="panel-header">
      <div>
        <div className="panel__eyebrow">{eyebrow}</div>
        <strong>{title}</strong>
      </div>
      {tag ? <Tag minimal>{tag}</Tag> : null}
    </div>
  );
}

function getSourceStateMeta(sourceState) {
  if (sourceState === "cached") {
    return {
      label: "cached",
      intent: Intent.SUCCESS,
      description: "최근에 받아온 최신 캐시값이다. LEO는 30분, GEO는 12시간 이내면 cached로 본다.",
    };
  }

  if (sourceState === "stale") {
    return {
      label: "stale",
      intent: Intent.WARNING,
      description: "마지막 성공 캐시를 재사용한 상태다. LEO 30분 초과 또는 GEO 12시간 초과 후 갱신 실패 시 stale로 본다.",
    };
  }

  return {
    label: "내장 스냅샷",
    intent: Intent.NONE,
    description: "앱에 번들된 기본 스냅샷 값이다. 캐시가 없거나 외부 갱신이 안 될 때 fallback으로 쓴다.",
  };
}

function OrbitSourceStateTag({ sourceState }) {
  const meta = getSourceStateMeta(sourceState);

  return (
    <Tooltip content={meta.description} placement="top">
      <Tag minimal intent={meta.intent}>
        {meta.label}
      </Tag>
    </Tooltip>
  );
}

function buildOrbitMetaLine(entry) {
  const parts = [];

  if (entry.domesticName) {
    parts.push(entry.domesticName);
  }

  if (entry.orbitLabel) {
    parts.push(entry.orbitLabel);
  }

  if (entry.orbitalSlot) {
    parts.push(entry.orbitalSlot);
  }

  if (entry.missionLabel) {
    parts.push(entry.missionLabel);
  }

  if (entry.operationalStatus) {
    parts.push(entry.operationalStatus);
  }

  return parts.join(" · ");
}

function formatPointDegrees(value, axis) {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}° ${suffix}`;
}

function formatPointAltitude(value) {
  return Number.isFinite(value) ? `${Math.round(value)} km` : "unknown";
}

function getGroupLabel(orbitClass) {
  if (orbitClass === "geo") {
    return "GEO";
  }

  if (orbitClass === "meo") {
    return "MEO";
  }

  if (orbitClass === "cislunar") {
    return "Cislunar";
  }

  return "LEO";
}

function supportsEarthGlobeTrack(item) {
  return item.orbitClass !== "cislunar" && item.norad !== "53365";
}

function formatCatalogAltitudeRange(apogeeKm, perigeeKm) {
  if (Number.isFinite(apogeeKm) && Number.isFinite(perigeeKm)) {
    return `${Math.round(perigeeKm)}-${Math.round(apogeeKm)} km`;
  }

  if (Number.isFinite(apogeeKm)) {
    return `${Math.round(apogeeKm)} km`;
  }

  if (Number.isFinite(perigeeKm)) {
    return `${Math.round(perigeeKm)} km`;
  }

  return "unknown";
}

function formatCatalogInclination(inclination) {
  return Number.isFinite(inclination) ? `${inclination.toFixed(2)}°` : "unknown";
}

function formatCatalogPeriod(periodMinutes) {
  return Number.isFinite(periodMinutes) ? `${periodMinutes.toFixed(2)} min` : "unknown";
}

function getCatalogTrackIntent(trackKey) {
  if (trackKey === "rendered") {
    return Intent.SUCCESS;
  }

  if (trackKey === "catalog-only") {
    return Intent.WARNING;
  }

  if (trackKey === "non-earth") {
    return Intent.PRIMARY;
  }

  return Intent.DANGER;
}

function compareCatalogValues(left, right, direction = "asc") {
  const order = direction === "asc" ? 1 : -1;

  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * order;
  }

  return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" }) * order;
}

export function OrbitCasePanel() {
  const [telemetry, setTelemetry] = useState([]);
  const [sourceMode, setSourceMode] = useState(() => {
    if (typeof window === "undefined") {
      return "snapshot";
    }

    const storedMode = window.localStorage.getItem(ORBIT_SOURCE_MODE_STORAGE_KEY);
    return storedMode === "live" ? "live" : "snapshot";
  });
  const [orbitFilter, setOrbitFilter] = useState("all");
  const [missionFilter, setMissionFilter] = useState("all");
  const [fleet, setFleet] = useState([]);
  const [sourceMeta, setSourceMeta] = useState({
    provider: "내장 스냅샷",
    isFallback: false,
    warning: "",
    updatedAt: null,
    freshnessLabel: "embedded",
    cachePolicy: "내장 스냅샷",
  });
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [showGlobalLeo, setShowGlobalLeo] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSatelliteNorad, setSelectedSatelliteNorad] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({
    leo: true,
    geo: true,
    meo: false,
    cislunar: true,
    unavailable: true,
  });
  const [leoBackdrop, setLeoBackdrop] = useState({
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
  });
  const [selectedLeoPoint, setSelectedLeoPoint] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFleet() {
      setLoadingFleet(true);

      try {
        const payload = await fetchSatelliteFleet(sourceMode);
        if (cancelled) {
          return;
        }

        setFleet(payload.fleet);
        setSourceMeta({
          provider: payload.provider,
          isFallback: payload.isFallback,
          warning: payload.warning,
          updatedAt: payload.updatedAt,
          freshnessLabel: payload.freshnessLabel,
          cachePolicy: payload.cachePolicy,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setFleet([]);
        setSourceMeta({
          provider: "Satellite API unavailable",
          isFallback: true,
          warning: error.message,
          updatedAt: null,
          freshnessLabel: "unavailable",
          cachePolicy: "API fetch failed",
        });
      } finally {
        if (!cancelled) {
          setLoadingFleet(false);
        }
      }
    }

    loadFleet();

    return () => {
      cancelled = true;
    };
  }, [sourceMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(ORBIT_SOURCE_MODE_STORAGE_KEY, sourceMode);
  }, [sourceMode]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function loadLeoBackdrop() {
      try {
        const payload = await fetchLeoBackdrop(sourceMode);
        if (cancelled) {
          return;
        }

        setLeoBackdrop(payload);
        setSelectedLeoPoint((currentSelection) => {
          if (!currentSelection) {
            return null;
          }

          return payload.points.find((point) => point.norad === currentSelection.norad) ?? null;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLeoBackdrop({
          provider: "LEO overlay disabled",
          warning: error.message,
          updatedAt: null,
          generatedAt: null,
          freshnessLabel: "off",
          cachePolicy: "Overlay unavailable",
          totalCount: 0,
          renderedCount: 0,
          sourceState: "snapshot",
          points: [],
        });
        setSelectedLeoPoint(null);
      }
    }

    if (sourceMode !== "live") {
      setLeoBackdrop({
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
      });
      setSelectedLeoPoint(null);
      return () => {
        cancelled = true;
      };
    }

    loadLeoBackdrop();
    timer = window.setInterval(loadLeoBackdrop, 10000);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [sourceMode]);

  const mergedFleet = useMemo(() => {
    const telemetryByNorad = new Map(telemetry.map((entry) => [entry.norad, entry]));
    return fleet.map((item) => ({
      ...item,
      ...(telemetryByNorad.get(item.norad) ?? {}),
    }));
  }, [fleet, telemetry]);

  const filteredFleet = useMemo(
    () =>
      mergedFleet.filter((item) => {
        const matchesOrbit = orbitFilter === "all" || item.orbitClass === orbitFilter;
        const matchesMission = missionFilter === "all" || item.missionType === missionFilter;
        const searchText = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !searchText ||
          [item.name, item.domesticName, item.norad, item.missionLabel, item.orbitLabel]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(searchText));

        return matchesOrbit && matchesMission && matchesSearch;
      }),
    [mergedFleet, missionFilter, orbitFilter, searchQuery],
  );
  const trackedCountLabel =
    filteredFleet.length === fleet.length ? `${filteredFleet.length} sats` : `${filteredFleet.length}/${fleet.length} sats`;
  const visibleLeoPoints = showGlobalLeo ? leoBackdrop.points : [];
  const globeFleet = useMemo(
    () => filteredFleet.filter((item) => supportsEarthGlobeTrack(item) && (item.omm || item.tle)),
    [filteredFleet],
  );
  const summary = useMemo(() => {
    const renderable = mergedFleet.filter((item) => supportsEarthGlobeTrack(item) && (item.omm || item.tle)).length;
    const unavailable = mergedFleet.length - renderable;
    const geoCount = mergedFleet.filter((item) => item.orbitClass === "geo").length;
    const leoCount = mergedFleet.filter((item) => item.orbitClass === "leo").length;
    const observationCount = mergedFleet.filter((item) => item.missionType === "earth-observation").length;
    const communicationsCount = mergedFleet.filter((item) => item.missionType === "communications").length;

    return {
      total: mergedFleet.length,
      renderable,
      unavailable,
      geoCount,
      leoCount,
      observationCount,
      communicationsCount,
    };
  }, [mergedFleet]);

  const browserGroups = useMemo(() => {
    const groups = [
      {
        key: "leo",
        label: "LEO",
        items: filteredFleet.filter((item) => item.orbitClass === "leo" && supportsEarthGlobeTrack(item) && (item.omm || item.tle)),
      },
      {
        key: "geo",
        label: "GEO",
        items: filteredFleet.filter((item) => item.orbitClass === "geo" && supportsEarthGlobeTrack(item) && (item.omm || item.tle)),
      },
      {
        key: "meo",
        label: "MEO",
        items: filteredFleet.filter((item) => item.orbitClass === "meo" && supportsEarthGlobeTrack(item) && (item.omm || item.tle)),
      },
      {
        key: "cislunar",
        label: "Unsupported on Earth globe",
        items: filteredFleet.filter((item) => !supportsEarthGlobeTrack(item)),
      },
      {
        key: "unavailable",
        label: "Ephemeris unavailable",
        items: filteredFleet.filter((item) => supportsEarthGlobeTrack(item) && !item.omm && !item.tle),
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [filteredFleet]);

  useEffect(() => {
    if (filteredFleet.length === 0) {
      setSelectedSatelliteNorad(null);
      return;
    }

    if (!filteredFleet.some((item) => item.norad === selectedSatelliteNorad)) {
      setSelectedSatelliteNorad(null);
    }
  }, [filteredFleet, selectedSatelliteNorad]);

  const selectedSatellite = useMemo(
    () => filteredFleet.find((item) => item.norad === selectedSatelliteNorad) ?? null,
    [filteredFleet, selectedSatelliteNorad],
  );

  return (
    <>
      <section className="panel-grid panel-grid--hero panel-grid--orbit-hero">
        <Card className="panel panel--visual panel--visual-fullbleed">
          <div className="panel-visual__title">
            <PanelTitle eyebrow="K-Sattie Case" title="Korea tracks + global LEO points" tag="Path + Point cloud" />
          </div>
          <CesiumOrbitDemo
            fleet={globeFleet}
            leoPoints={visibleLeoPoints}
            onSatelliteSelectionChange={(payload) => setSelectedSatelliteNorad(payload?.norad ?? null)}
            onTelemetryChange={setTelemetry}
            onPointSelectionChange={setSelectedLeoPoint}
          />
        </Card>

        <Card className="panel">
          <PanelTitle
            eyebrow="KOREA TRACKING"
            title="Telemetry + overlay status"
            tag={sourceMode === "live" ? `Cached OMM · ${trackedCountLabel}` : `내장 스냅샷 · ${trackedCountLabel}`}
          />
          <div className="segment-filter orbit-source-filter">
            <Button
              active={sourceMode === "live"}
              minimal={sourceMode !== "live"}
              loading={loadingFleet && sourceMode === "live"}
              onClick={() => setSourceMode("live")}
            >
              최신 캐시값
            </Button>
            <Button
              active={sourceMode === "snapshot"}
              minimal={sourceMode !== "snapshot"}
              onClick={() => setSourceMode("snapshot")}
            >
              내장 스냅샷
            </Button>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">표시 범위</span>
            <div className="segment-filter">
              <Button active={!showGlobalLeo} minimal={showGlobalLeo} onClick={() => setShowGlobalLeo(false)}>
                대한민국 위성
              </Button>
              <Button active={showGlobalLeo} minimal={!showGlobalLeo} onClick={() => setShowGlobalLeo(true)}>
                전체 LEO 위성
              </Button>
            </div>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">궤도</span>
            <div className="segment-filter">
              <Button active={orbitFilter === "all"} minimal={orbitFilter !== "all"} onClick={() => setOrbitFilter("all")}>
                전체
              </Button>
              <Button active={orbitFilter === "leo"} minimal={orbitFilter !== "leo"} onClick={() => setOrbitFilter("leo")}>
                LEO만
              </Button>
              <Button active={orbitFilter === "geo"} minimal={orbitFilter !== "geo"} onClick={() => setOrbitFilter("geo")}>
                GEO만
              </Button>
            </div>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">임무</span>
            <div className="segment-filter">
              <Button
                active={missionFilter === "all"}
                minimal={missionFilter !== "all"}
                onClick={() => setMissionFilter("all")}
              >
                전체
              </Button>
              <Button
                active={missionFilter === "earth-observation"}
                minimal={missionFilter !== "earth-observation"}
                onClick={() => setMissionFilter("earth-observation")}
              >
                지구관측
              </Button>
              <Button
                active={missionFilter === "communications"}
                minimal={missionFilter !== "communications"}
                onClick={() => setMissionFilter("communications")}
              >
                통신
              </Button>
            </div>
          </div>
          <div className="orbit-source-status">
            <span>{sourceMeta.provider}</span>
            <span>{sourceMeta.updatedAt ? sourceMeta.updatedAt.slice(0, 19).replace("T", " ") : "embedded snapshot"}</span>
          </div>
          <div className="orbit-source-status orbit-source-status--secondary">
            <span>{sourceMeta.cachePolicy}</span>
            <span>{sourceMeta.freshnessLabel}</span>
          </div>
          {sourceMeta.warning ? (
            <div className="orbit-source-warning">
              {sourceMeta.isFallback ? "Fallback" : "Notice"} · {sourceMeta.warning}
            </div>
          ) : null}
          <div className="orbit-summary-grid">
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Fleet</span>
              <strong>{summary.total}</strong>
              <span>{summary.renderable} trackable</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Orbit mix</span>
              <strong>{summary.leoCount}</strong>
              <span>LEO · {summary.geoCount} GEO</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Mission mix</span>
              <strong>{summary.observationCount}</strong>
              <span>EO · {summary.communicationsCount} Comms</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Warnings</span>
              <strong>{summary.unavailable}</strong>
              <span>Ephemeris missing</span>
            </div>
          </div>
          <div className="orbit-overlay-summary">
            <div className="orbit-overlay-summary__header">
              <strong>Global LEO point cloud</strong>
              <OrbitSourceStateTag sourceState={leoBackdrop.sourceState} />
            </div>
            <div className="orbit-source-status">
              <span>{leoBackdrop.provider}</span>
              <span>{leoBackdrop.updatedAt ? leoBackdrop.updatedAt.slice(0, 19).replace("T", " ") : "inactive"}</span>
            </div>
            <div className="orbit-source-status orbit-source-status--secondary">
              <span>{leoBackdrop.cachePolicy}</span>
              <span>{leoBackdrop.generatedAt ? leoBackdrop.generatedAt.slice(11, 19) : leoBackdrop.freshnessLabel}</span>
            </div>
            <div className="orbit-overlay-summary__counts">
              <span>{visibleLeoPoints.length.toLocaleString()} points rendered</span>
              <span>{leoBackdrop.totalCount.toLocaleString()} cached payloads</span>
            </div>
            {!showGlobalLeo ? (
              <div className="orbit-source-warning">Notice · 대한민국 위성만 보기 모드라서 전역 LEO 점 레이어를 숨겼다.</div>
            ) : null}
            {leoBackdrop.warning ? <div className="orbit-source-warning">Notice · {leoBackdrop.warning}</div> : null}
          </div>
          <div className="orbit-selected-point">
            <div className="orbit-selected-point__header">
              <strong>Selected Korean satellite</strong>
            </div>
            {selectedSatellite ? (
              <div className="metric-row metric-row--selected">
                <div>
                  <strong className="orbit-entry-title">
                    <span>{selectedSatellite.englishName ?? selectedSatellite.name}</span>
                    <OrbitSourceStateTag sourceState={selectedSatellite.sourceState} />
                  </strong>
                  <span>{buildOrbitMetaLine(selectedSatellite)}</span>
                  <span>
                    NORAD {selectedSatellite.norad} · {selectedSatellite.sourceDate ?? "unavailable"}
                  </span>
                  <span>
                    {selectedSatellite.latitude && selectedSatellite.longitude
                      ? `${selectedSatellite.latitude} · ${selectedSatellite.longitude}`
                      : selectedSatellite.sourceLabel}
                  </span>
                </div>
                <div className="metric-row__value">
                  <span>{selectedSatellite.altitude ?? selectedSatellite.sourceLabel}</span>
                  <ProgressBar
                    value={
                      selectedSatellite.altitude
                        ? Math.min(Number.parseInt(selectedSatellite.altitude, 10) / 1000, 1)
                        : 0.16
                    }
                    intent={Intent.PRIMARY}
                  />
                </div>
              </div>
            ) : (
              <div className="orbit-empty-state">아래 브라우저에서 위성을 선택하면 현재 위치와 상태를 보여준다.</div>
            )}
          </div>
          <div className="orbit-selected-point">
            <div className="orbit-selected-point__header">
              <strong>Selected non-Korean point</strong>
            </div>
            {selectedLeoPoint ? (
              <div className="metric-row metric-row--selected">
                <div>
                  <strong className="orbit-entry-title">
                    <span>{selectedLeoPoint.name}</span>
                    <OrbitSourceStateTag sourceState={selectedLeoPoint.sourceState} />
                  </strong>
                  <span>NORAD {selectedLeoPoint.norad}</span>
                  <span>
                    {formatPointDegrees(selectedLeoPoint.latitude, "lat")} ·{" "}
                    {formatPointDegrees(selectedLeoPoint.longitude, "lon")}
                  </span>
                </div>
                <div className="metric-row__value">
                  <span>{formatPointAltitude(selectedLeoPoint.altitudeKm)}</span>
                  <ProgressBar value={Math.min(selectedLeoPoint.altitudeKm / 2000, 1)} intent={Intent.PRIMARY} />
                </div>
              </div>
            ) : (
              <div className="orbit-empty-state">지구본 위 점을 클릭하면 선택한 비한국 위성의 현재 위치를 보여준다.</div>
            )}
          </div>
        </Card>
      </section>

      <section className="panel-grid panel-grid--single">
        <Card className="panel">
          <div className="orbit-browser__header">
            <PanelTitle eyebrow="SATELLITE BROWSER" title="Map-linked Korean satellite list" tag={`${filteredFleet.length} shown`} />
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">검색</span>
            <InputGroup
              value={searchQuery}
              leftIcon="search"
              placeholder="이름, NORAD, 임무, 궤도"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className="orbit-browser">
            {browserGroups.length > 0 ? (
              browserGroups.map((group) => (
                <div key={group.key} className="orbit-group">
                  <button
                    type="button"
                    className="orbit-group__toggle"
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.key]: !current[group.key],
                      }))
                    }
                  >
                    <span>{group.label}</span>
                    <span>{group.items.length}</span>
                  </button>
                  {expandedGroups[group.key] ? (
                    <div className="orbit-group__list">
                      {group.items.map((entry) => (
                        <button
                          key={entry.norad}
                          type="button"
                          className={`orbit-browser__item ${
                            entry.norad === selectedSatelliteNorad ? "orbit-browser__item--active" : ""
                          }`}
                          onClick={() => setSelectedSatelliteNorad(entry.norad)}
                        >
                          <div>
                            <strong className="orbit-entry-title">
                              <span>{entry.englishName ?? entry.name}</span>
                              <OrbitSourceStateTag sourceState={entry.sourceState} />
                            </strong>
                            <span>{buildOrbitMetaLine(entry)}</span>
                            <span>NORAD {entry.norad}</span>
                          </div>
                          <div className="orbit-browser__item-meta">
                            <span>{entry.altitude ?? entry.sourceLabel}</span>
                            <span>{getGroupLabel(entry.orbitClass)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="orbit-empty-state">선택한 필터에 맞는 위성이 없다.</div>
            )}
          </div>
        </Card>
      </section>

    </>
  );
}

export function CatalogSummaryPanel() {
  const [payload, setPayload] = useState({
    updatedAt: null,
    summary: null,
    rows: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [orbitFilter, setOrbitFilter] = useState("all");
  const [trackFilter, setTrackFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({
    key: "launchDate",
    direction: "desc",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);

      try {
        const nextPayload = await fetchSatelliteCatalogSummary();
        if (!cancelled) {
          setPayload(nextPayload);
          setError("");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const searchText = searchQuery.trim().toLowerCase();

    return payload.rows.filter((row) => {
      const matchesOrbit = orbitFilter === "all" || row.orbitClass === orbitFilter;
      const matchesTrack = trackFilter === "all" || row.trackKey === trackFilter;
      const matchesSearch =
        !searchText ||
        [
          row.englishName,
          row.domesticName,
          row.norad,
          row.objectId,
          row.orbitLabel,
          row.missionLabel,
          row.trackLabel,
          row.site,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchText));

      return matchesOrbit && matchesTrack && matchesSearch;
    });
  }, [orbitFilter, payload.rows, searchQuery, trackFilter]);

  const sortedRows = useMemo(() => {
    const valueResolvers = {
      englishName: (row) => row.englishName,
      norad: (row) => Number(row.norad),
      orbitLabel: (row) => row.orbitLabel,
      missionLabel: (row) => row.missionLabel,
      launchDate: (row) => row.launchDate,
      altitude: (row) => Math.max(row.apogeeKm ?? -Infinity, row.perigeeKm ?? -Infinity),
      inclination: (row) => row.inclination,
      periodMinutes: (row) => row.periodMinutes,
      trackLabel: (row) => row.trackLabel,
    };

    const resolveValue = valueResolvers[sortConfig.key] ?? valueResolvers.launchDate;

    return [...filteredRows].sort((left, right) => {
      const primary = compareCatalogValues(resolveValue(left), resolveValue(right), sortConfig.direction);
      if (primary !== 0) {
        return primary;
      }

      return compareCatalogValues(left.englishName, right.englishName, "asc");
    });
  }, [filteredRows, sortConfig]);

  const filteredCounts = useMemo(
    () => ({
      rendered: filteredRows.filter((row) => row.trackKey === "rendered").length,
      catalogOnly: filteredRows.filter((row) => row.trackKey === "catalog-only").length,
      nonEarth: filteredRows.filter((row) => row.trackKey === "non-earth").length,
      decayed: filteredRows.filter((row) => row.trackKey === "decayed").length,
    }),
    [filteredRows],
  );

  const summary = payload.summary;

  function toggleSort(nextKey) {
    setSortConfig((current) => ({
      key: nextKey,
      direction: current.key === nextKey && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortHeader(label, key) {
    const isActive = sortConfig.key === key;
    const arrow = !isActive ? "" : sortConfig.direction === "asc" ? "▲" : "▼";

    return (
      <button
        type="button"
        className={`catalog-sort-button ${isActive ? "catalog-sort-button--active" : ""}`}
        onClick={() => toggleSort(key)}
      >
        <span>{label}</span>
        <span className="catalog-sort-button__arrow">{arrow}</span>
      </button>
    );
  }

  return (
    <>
      <section className="panel-grid panel-grid--single">
        <Card className="panel">
          <PanelTitle
            eyebrow="CSV SUMMARY"
            title="대한민국 위성 payload 카탈로그 요약"
            tag={summary ? `${sortedRows.length}/${summary.total} rows` : "loading"}
          />
          <div className="catalog-summary-grid">
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">CSV rows</span>
              <strong>{summary?.total ?? 0}</strong>
              <span>{summary ? `${summary.current} current payloads` : "Loading summary"}</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Earth render</span>
              <strong>{summary?.rendered ?? 0}</strong>
              <span>{summary ? `${summary.catalogOnly} catalog only` : "Ephemeris check"}</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Orbit mix</span>
              <strong>{summary ? summary.orbitCounts.leo + summary.orbitCounts.geo : 0}</strong>
              <span>
                {summary
                  ? `LEO ${summary.orbitCounts.leo} · GEO ${summary.orbitCounts.geo} · Other ${
                      summary.orbitCounts.meo + summary.orbitCounts.cislunar
                    }`
                  : "Orbit counts"}
              </span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Launch span</span>
              <strong>{summary?.launchSpan.last ?? "unknown"}</strong>
              <span>{summary ? `${summary.launchSpan.first}부터 현재 CSV까지` : "Launch history"}</span>
            </div>
          </div>

          <div className="catalog-toolbar">
            <div className="orbit-filter-group catalog-toolbar__search">
              <span className="orbit-filter-group__label">검색</span>
              <InputGroup
                value={searchQuery}
                leftIcon="search"
                placeholder="위성명, NORAD, OBJECT_ID, 임무, 발사장"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="orbit-filter-group">
              <span className="orbit-filter-group__label">궤도</span>
              <div className="segment-filter">
                <Button active={orbitFilter === "all"} minimal={orbitFilter !== "all"} onClick={() => setOrbitFilter("all")}>
                  전체
                </Button>
                <Button active={orbitFilter === "leo"} minimal={orbitFilter !== "leo"} onClick={() => setOrbitFilter("leo")}>
                  LEO
                </Button>
                <Button active={orbitFilter === "geo"} minimal={orbitFilter !== "geo"} onClick={() => setOrbitFilter("geo")}>
                  GEO
                </Button>
                <Button active={orbitFilter === "meo"} minimal={orbitFilter !== "meo"} onClick={() => setOrbitFilter("meo")}>
                  MEO
                </Button>
                <Button
                  active={orbitFilter === "cislunar"}
                  minimal={orbitFilter !== "cislunar"}
                  onClick={() => setOrbitFilter("cislunar")}
                >
                  Lunar
                </Button>
              </div>
            </div>

            <div className="orbit-filter-group">
              <span className="orbit-filter-group__label">표출 상태</span>
              <div className="segment-filter">
                <Button active={trackFilter === "all"} minimal={trackFilter !== "all"} onClick={() => setTrackFilter("all")}>
                  전체
                </Button>
                <Button
                  active={trackFilter === "rendered"}
                  minimal={trackFilter !== "rendered"}
                  onClick={() => setTrackFilter("rendered")}
                >
                  지구본 렌더
                </Button>
                <Button
                  active={trackFilter === "catalog-only"}
                  minimal={trackFilter !== "catalog-only"}
                  onClick={() => setTrackFilter("catalog-only")}
                >
                  Catalog only
                </Button>
                <Button
                  active={trackFilter === "non-earth"}
                  minimal={trackFilter !== "non-earth"}
                  onClick={() => setTrackFilter("non-earth")}
                >
                  Non-Earth
                </Button>
                <Button
                  active={trackFilter === "decayed"}
                  minimal={trackFilter !== "decayed"}
                  onClick={() => setTrackFilter("decayed")}
                >
                  Decayed
                </Button>
              </div>
            </div>
          </div>

          <div className="catalog-summary-note">
            <strong>{payload.updatedAt ? payload.updatedAt.slice(0, 19).replace("T", " ") : "Summary pending"}</strong>
            <span>
              필터 결과 {sortedRows.length}기 · 렌더 {filteredCounts.rendered} · catalog only {filteredCounts.catalogOnly} ·
              non-Earth {filteredCounts.nonEarth} · decayed {filteredCounts.decayed}
            </span>
          </div>
          {error ? <div className="orbit-source-warning">{error}</div> : null}
        </Card>
      </section>

      <section className="panel-grid panel-grid--single">
        <Card className="panel panel--table">
          <PanelTitle eyebrow="CSV TABLE" title="space-track-skor-current-payloads.csv" tag={`${sortedRows.length} visible`} />
          <div className="catalog-table-wrap">
            {loading ? (
              <div className="orbit-empty-state">CSV summary loading...</div>
            ) : (
              <HTMLTable className="work-table catalog-table" striped interactive>
                <thead>
                  <tr>
                    <th>{renderSortHeader("위성명", "englishName")}</th>
                    <th>{renderSortHeader("NORAD", "norad")}</th>
                    <th>{renderSortHeader("궤도", "orbitLabel")}</th>
                    <th>{renderSortHeader("임무", "missionLabel")}</th>
                    <th>{renderSortHeader("발사일", "launchDate")}</th>
                    <th>{renderSortHeader("고도", "altitude")}</th>
                    <th>{renderSortHeader("경사각", "inclination")}</th>
                    <th>{renderSortHeader("주기", "periodMinutes")}</th>
                    <th>{renderSortHeader("표출 상태", "trackLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.norad}>
                      <td>
                        <div className="title-cell catalog-table__title">
                          <strong>{row.englishName}</strong>
                          <span>{row.objectId ?? "OBJECT_ID unavailable"}</span>
                          <span>{row.site ?? "Launch site unavailable"}</span>
                        </div>
                      </td>
                      <td className="catalog-table__mono">{row.norad}</td>
                      <td>
                        <div className="title-cell">
                          <strong>{row.orbitLabel}</strong>
                          <span>{row.operationalStatus}</span>
                        </div>
                      </td>
                      <td>
                        <div className="title-cell">
                          <strong>{row.missionLabel}</strong>
                          <span>{row.objectType ?? "PAYLOAD"}</span>
                        </div>
                      </td>
                      <td className="catalog-table__mono">{row.launchDate ?? "unknown"}</td>
                      <td className="catalog-table__mono">
                        {formatCatalogAltitudeRange(row.apogeeKm, row.perigeeKm)}
                      </td>
                      <td className="catalog-table__mono">{formatCatalogInclination(row.inclination)}</td>
                      <td className="catalog-table__mono">{formatCatalogPeriod(row.periodMinutes)}</td>
                      <td>
                        <div className="catalog-status-cell">
                          <Tag minimal intent={getCatalogTrackIntent(row.trackKey)}>
                            {row.trackLabel}
                          </Tag>
                          <span>{row.trackDetail}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
          </div>
        </Card>
      </section>
    </>
  );
}

export function RasterCasePanel() {
  return (
    <>
      <section className="panel-grid panel-grid--hero">
        <Card className="panel panel--visual">
          <PanelTitle eyebrow="WORLDWIND CASE" title="Raster overlay and atmospheric layer" tag="Layer stack" />
          <div className="viz-frame">
            <svg viewBox="0 0 640 360" className="globe-svg globe-svg--raster" role="img" aria-label="Raster overlay sample">
              <defs>
                <radialGradient id="rasterEarth" cx="45%" cy="34%" r="68%">
                  <stop offset="0%" stopColor="#3f6a90" />
                  <stop offset="48%" stopColor="#183450" />
                  <stop offset="100%" stopColor="#0a1522" />
                </radialGradient>
                <clipPath id="rasterClip">
                  <circle cx="238" cy="180" r="126" />
                </clipPath>
              </defs>
              <circle cx="238" cy="180" r="126" fill="url(#rasterEarth)" />
              <g clipPath="url(#rasterClip)">
                <rect x="118" y="110" width="120" height="74" fill="rgba(234,103,103,0.48)" />
                <rect x="188" y="166" width="144" height="82" fill="rgba(84,184,137,0.30)" />
                <circle cx="208" cy="144" r="52" fill="rgba(215,160,85,0.26)" />
                <circle cx="290" cy="208" r="62" fill="rgba(94,140,198,0.32)" />
                <path d="M110 150 C180 120, 226 150, 316 122" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="7" />
                <path d="M126 228 C190 188, 250 220, 336 194" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="5" />
              </g>
              <circle cx="238" cy="180" r="126" fill="none" stroke="rgba(155,198,255,0.30)" strokeWidth="2" />
              <rect x="430" y="80" width="148" height="172" fill="rgba(7,17,29,0.78)" stroke="rgba(125,160,201,0.16)" />
              <text x="450" y="110" fill="#9bc6ff" fontSize="12">ACTIVE LAYERS</text>
              <text x="450" y="142" fill="#eef4fb" fontSize="14">Cloud density</text>
              <rect x="450" y="150" width="108" height="8" fill="rgba(94,140,198,0.22)" />
              <rect x="450" y="150" width="82" height="8" fill="#5e8cc6" />
              <text x="450" y="182" fill="#eef4fb" fontSize="14">Thermal anomaly</text>
              <rect x="450" y="190" width="108" height="8" fill="rgba(234,103,103,0.22)" />
              <rect x="450" y="190" width="52" height="8" fill="#ea6767" />
              <text x="450" y="222" fill="#eef4fb" fontSize="14">Aerosol plume</text>
              <rect x="450" y="230" width="108" height="8" fill="rgba(215,160,85,0.22)" />
              <rect x="450" y="230" width="68" height="8" fill="#d7a055" />
            </svg>
          </div>
        </Card>

        <Card className="panel">
          <PanelTitle eyebrow="LAYER MIX" title="Overlay intensity" tag="Raster cells" />
          <div className="metric-list">
            {rasterLayers.map((layer) => (
              <div key={layer.name} className="metric-row">
                <div>
                  <strong>{layer.name}</strong>
                  <span>WorldWind renderable layer</span>
                </div>
                <div className="metric-row__value">
                  <span>{Math.round(layer.value * 100)}%</span>
                  <ProgressBar value={layer.value} intent={layer.tone} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="panel-grid">
        <Card className="panel">
          <PanelTitle eyebrow="OBSERVED CELLS" title="Current raster snapshots" tag="3 regions" />
          <div className="data-list">
            {rasterCells.map((cell) => (
              <div key={cell.region} className="data-row">
                <div>
                  <strong>{cell.region}</strong>
                  <span>{cell.signal}</span>
                </div>
                <Tag minimal round>
                  {cell.update}
                </Tag>
              </div>
            ))}
          </div>
        </Card>

        <Card className="panel">
          <PanelTitle eyebrow="WHY THIS CASE" title="WorldWind fits public raster data" tag="Use case 02" />
          <div className="explain-list">
            <p>기상, 대기, 해양처럼 타일 또는 래스터 기반 데이터를 지구본 위에 중첩하는 데 적합하다.</p>
            <p>`RenderableLayer` 중심 구조라 공공 데이터셋과 분석성 오버레이를 붙이기 쉽다.</p>
            <p>실서비스에서는 레이어 토글, 투영 전환, 색상 범례를 이 샘플 패널 위에 확장하면 된다.</p>
          </div>
        </Card>
      </section>
    </>
  );
}

export function NetworkCasePanel() {
  return (
    <>
      <section className="panel-grid panel-grid--hero">
        <Card className="panel panel--visual">
          <PanelTitle eyebrow="DECK.GL CASE" title="Signal network and crosslink density" tag="Arc + Scatter" />
          <div className="viz-frame">
            <svg viewBox="0 0 640 360" className="globe-svg globe-svg--network" role="img" aria-label="Network sample">
              <defs>
                <radialGradient id="networkEarth" cx="42%" cy="34%" r="70%">
                  <stop offset="0%" stopColor="#2b5e73" />
                  <stop offset="54%" stopColor="#17394b" />
                  <stop offset="100%" stopColor="#09131f" />
                </radialGradient>
              </defs>
              <circle cx="240" cy="184" r="124" fill="url(#networkEarth)" />
              <circle cx="240" cy="184" r="124" fill="none" stroke="rgba(155,198,255,0.28)" strokeWidth="2" />
              <path d="M174 138 C210 92, 286 88, 330 126" fill="none" stroke="rgba(94,140,198,0.72)" strokeWidth="3" />
              <path d="M178 218 C250 132, 330 140, 350 204" fill="none" stroke="rgba(84,184,137,0.72)" strokeWidth="3" />
              <path d="M150 210 C188 122, 318 102, 356 156" fill="none" stroke="rgba(234,103,103,0.72)" strokeWidth="3" />
              <circle cx="176" cy="138" r="6" fill="#9bc6ff" />
              <circle cx="332" cy="126" r="6" fill="#9bc6ff" />
              <circle cx="178" cy="218" r="6" fill="#54b889" />
              <circle cx="350" cy="204" r="6" fill="#54b889" />
              <circle cx="150" cy="210" r="6" fill="#ea6767" />
              <circle cx="356" cy="156" r="6" fill="#ea6767" />
              <text x="126" y="228" fill="#eef4fb" fontSize="12">Seoul</text>
              <text x="362" y="164" fill="#eef4fb" fontSize="12">Guam</text>
              <rect x="430" y="86" width="150" height="166" fill="rgba(7,17,29,0.78)" stroke="rgba(125,160,201,0.16)" />
              <text x="448" y="116" fill="#9bc6ff" fontSize="12">LIVE NETWORK</text>
              <text x="448" y="146" fill="#eef4fb" fontSize="22">128 links</text>
              <text x="448" y="176" fill="#a7b6c7" fontSize="12">Crosslink load</text>
              <text x="448" y="196" fill="#eef4fb" fontSize="14">84% median occupancy</text>
              <text x="448" y="224" fill="#a7b6c7" fontSize="12">Peak corridor</text>
              <text x="448" y="244" fill="#eef4fb" fontSize="14">{"East Asia -> Pacific"}</text>
            </svg>
          </div>
        </Card>

        <Card className="panel">
          <PanelTitle eyebrow="ROUTE TABLE" title="Active routes" tag="Arc samples" />
          <div className="data-list">
            {networkRoutes.map((route) => (
              <div key={route.route} className="data-row data-row--stacked">
                <div>
                  <strong>{route.route}</strong>
                  <span>{route.latency}</span>
                </div>
                <Tag minimal round>
                  {route.capacity}
                </Tag>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="panel-grid">
        <Card className="panel">
          <PanelTitle eyebrow="RELAY NODES" title="Node density snapshot" tag="GPU-friendly" />
          <div className="metric-list">
            {relayNodes.map((node) => (
              <div key={node.name} className="metric-row">
                <div>
                  <strong>{node.name}</strong>
                  <span>Scatter + arc aggregation</span>
                </div>
                <div className="metric-row__value">
                  <span>{node.links} links</span>
                  <ProgressBar value={node.links / 20} intent={node.severity} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="panel">
          <PanelTitle eyebrow="WHY THIS CASE" title="Deck.gl fits dense network overlays" tag="Use case 03" />
          <div className="explain-list">
            <p>수많은 위성 노드, 지상국, Arc 연결을 GPU로 밀어붙이기에 가장 유리한 조합이다.</p>
            <p>운영 대시보드 안에 들어가는 네트워크 인포그래픽, 히트맵, 신호 강도 분포에 적합하다.</p>
            <p>실서비스에서는 이 샘플을 `ScatterplotLayer`, `ArcLayer`, `HeatmapLayer` 조합으로 교체하면 된다.</p>
          </div>
        </Card>
      </section>
    </>
  );
}
