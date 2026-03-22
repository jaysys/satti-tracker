import { Button, Card, HTMLTable, InputGroup, Intent, PopoverInteractionKind, ProgressBar, Tag, Tooltip } from "@blueprintjs/core";
import { useEffect, useMemo, useState } from "react";
import { fetchAirkoreaDashboard, fetchLeoBackdrop, fetchSatelliteCatalogSummary, fetchSatelliteFleet } from "../api";
import CesiumOrbitDemo from "./CesiumOrbitDemo";
import WorldCountriesDemo from "./WorldCountriesDemo";
import WorldWindRasterDemo from "./WorldWindRasterDemo";

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

function isStarlinkPoint(point) {
  return String(point?.name ?? "")
    .toUpperCase()
    .includes("STARLINK");
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

function renderWarningContent(summary, details) {
  if (!summary) {
    return null;
  }

  const detailLines = details
    ? details
        .split(" / ")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  if (!details || details === summary) {
    return (
      <div className="orbit-source-tooltip">
        <strong>{summary}</strong>
      </div>
    );
  }

  return (
    <div className="orbit-source-tooltip">
      <strong>{summary}</strong>
      <div className="orbit-source-tooltip__list">
        {detailLines.map((line) => (
          <div className="orbit-source-tooltip__item" key={line}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
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
  const [fleet, setFleet] = useState([]);
  const [sourceMeta, setSourceMeta] = useState({
    provider: "내장 스냅샷",
    isFallback: false,
    warning: "",
    warningDetails: "",
    updatedAt: null,
    freshnessLabel: "embedded",
    cachePolicy: "내장 스냅샷",
  });
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [overlayScope, setOverlayScope] = useState("leo");
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
          warningDetails: payload.warningDetails ?? payload.warning,
          updatedAt: payload.updatedAt,
          freshnessLabel: payload.freshnessLabel,
          cachePolicy: payload.cachePolicy,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSourceMeta({
          provider: fleet.length > 0 ? "Using previous cached fleet" : "Satellite API unavailable",
          isFallback: true,
          warning: error.message,
          warningDetails: error.message,
          updatedAt: null,
          freshnessLabel: "unavailable",
          cachePolicy: fleet.length > 0 ? "Previous fleet retained" : "API fetch failed",
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

        setLeoBackdrop((current) => ({
          ...current,
          provider: current.points.length > 0 ? current.provider : "LEO overlay disabled",
          warning: error.message,
          freshnessLabel: current.points.length > 0 ? current.freshnessLabel : "off",
          cachePolicy: current.points.length > 0 ? current.cachePolicy : "Overlay unavailable",
        }));
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
        const searchText = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !searchText ||
          [item.name, item.domesticName, item.norad, item.orbitLabel]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(searchText));

        return matchesOrbit && matchesSearch;
      }),
    [mergedFleet, orbitFilter, searchQuery],
  );
  const trackedCountLabel =
    filteredFleet.length === fleet.length ? `${filteredFleet.length} sats` : `${filteredFleet.length}/${fleet.length} sats`;
  const starlinkLeoPoints = useMemo(() => leoBackdrop.points.filter((point) => isStarlinkPoint(point)), [leoBackdrop.points]);
  const visibleLeoPoints = useMemo(() => {
    if (overlayScope === "korea") {
      return [];
    }

    if (overlayScope === "starlink") {
      return starlinkLeoPoints;
    }

    return leoBackdrop.points;
  }, [overlayScope, leoBackdrop.points, starlinkLeoPoints]);
  const globeFleet = useMemo(
    () => filteredFleet.filter((item) => supportsEarthGlobeTrack(item) && (item.omm || item.tle)),
    [filteredFleet],
  );
  const summary = useMemo(() => {
    const renderable = mergedFleet.filter((item) => supportsEarthGlobeTrack(item) && (item.omm || item.tle)).length;
    const unavailable = mergedFleet.length - renderable;
    const geoCount = mergedFleet.filter((item) => item.orbitClass === "geo").length;
    const leoCount = mergedFleet.filter((item) => item.orbitClass === "leo").length;

    return {
      total: mergedFleet.length,
      renderable,
      unavailable,
      geoCount,
      leoCount,
    };
  }, [mergedFleet]);

  useEffect(() => {
    if (!selectedLeoPoint) {
      return;
    }

    const stillVisible = visibleLeoPoints.some((point) => point.norad === selectedLeoPoint.norad);
    if (!stillVisible) {
      setSelectedLeoPoint(null);
    }
  }, [selectedLeoPoint, visibleLeoPoints]);

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
              <Button active={overlayScope === "korea"} minimal={overlayScope !== "korea"} onClick={() => setOverlayScope("korea")}>
                대한민국 위성
              </Button>
              <Button active={overlayScope === "leo"} minimal={overlayScope !== "leo"} onClick={() => setOverlayScope("leo")}>
                전체 LEO 위성
              </Button>
              <Button
                active={overlayScope === "starlink"}
                minimal={overlayScope !== "starlink"}
                onClick={() => setOverlayScope("starlink")}
              >
                스타링크
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
          <div className="orbit-source-status">
            <span>{sourceMeta.provider}</span>
            <span>{sourceMeta.updatedAt ? sourceMeta.updatedAt.slice(0, 19).replace("T", " ") : "embedded snapshot"}</span>
          </div>
          <div className="orbit-source-status orbit-source-status--secondary">
            <span>{sourceMeta.cachePolicy}</span>
            <span>{sourceMeta.freshnessLabel}</span>
          </div>
          {sourceMeta.warning ? (
            <Tooltip
              content={renderWarningContent(sourceMeta.warning, sourceMeta.warningDetails)}
              placement="bottom-start"
              popoverClassName="orbit-source-tooltip-popover"
              interactionKind={PopoverInteractionKind.HOVER}
              hoverCloseDelay={180}
            >
              <div className="orbit-source-warning">
                {sourceMeta.isFallback ? "Fallback" : "Notice"} · {sourceMeta.warning}
              </div>
            </Tooltip>
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
            {overlayScope === "korea" ? (
              <div className="orbit-source-warning">Notice · 대한민국 위성만 보기 모드라서 전역 LEO 점 레이어를 숨겼다.</div>
            ) : null}
            {overlayScope === "starlink" ? (
              <div className="orbit-source-warning">
                Notice · 스타링크 점 레이어만 표출 중이다. 대한민국 위성 궤도와 회전 애니메이션은 그대로 유지된다.
              </div>
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
              placeholder="이름, NORAD, 궤도"
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
      current: (row) => (row.current ? 1 : 0),
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
                placeholder="위성명, NORAD, OBJECT_ID, 발사장"
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
                    <th>{renderSortHeader("CURRENT", "current")}</th>
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
                          <span>{row.objectType ?? "PAYLOAD"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="title-cell">
                          <strong>{row.current ? "Y" : "N"}</strong>
                          <span>{row.current ? "CURRENT=Y" : "CURRENT=N"}</span>
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
  const [fleet, setFleet] = useState([]);
  const [airDashboard, setAirDashboard] = useState({
    provider: "AirKorea unavailable",
    fetchedAt: null,
    updatedAt: null,
    cachePolicy: "",
    warning: "",
    summary: {
      stationCount: 0,
      pm25Average: null,
      pm10Average: null,
      badStationCount: 0,
    },
    topPm25Stations: [],
    bySido: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadingAir, setLoadingAir] = useState(true);
  const [error, setError] = useState("");
  const [showSatellites, setShowSatellites] = useState(true);
  const [showTrueColor, setShowTrueColor] = useState(true);
  const [showAerosol, setShowAerosol] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [rasterOpacity, setRasterOpacity] = useState(0.6);
  const [selectedSatelliteNorad, setSelectedSatelliteNorad] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFleet() {
      setLoading(true);

      try {
        const payload = await fetchSatelliteFleet("snapshot");
        if (cancelled) {
          return;
        }

        setFleet(payload.fleet);
        setError("");
      } catch (nextError) {
        if (!cancelled) {
          setFleet([]);
          setError(nextError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFleet();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAirDashboard() {
      setLoadingAir(true);

      try {
        const payload = await fetchAirkoreaDashboard();
        if (!cancelled) {
          setAirDashboard(payload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setAirDashboard((current) => ({
            ...current,
            warning: nextError.message,
          }));
        }
      } finally {
        if (!cancelled) {
          setLoadingAir(false);
        }
      }
    }

    loadAirDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const renderableFleet = useMemo(
    () => fleet.filter((item) => item.orbitClass !== "cislunar" && item.norad !== "53365" && (item.omm || item.tle)),
    [fleet],
  );
  const selectedSatellite = useMemo(
    () => renderableFleet.find((item) => item.norad === selectedSatelliteNorad) ?? null,
    [renderableFleet, selectedSatelliteNorad],
  );

  return (
    <>
      <section className="panel-grid panel-grid--hero">
        <Card className="panel panel--visual panel--visual-fullbleed">
          <div className="panel-visual__title">
            <PanelTitle eyebrow="WORLDWIND CASE" title="NASA GIBS true color + aerosol" tag="NRT WMS" />
          </div>
          <WorldWindRasterDemo
            fleet={renderableFleet}
            selectedNorad={selectedSatelliteNorad}
            showSatellites={showSatellites}
            showTrueColor={showTrueColor}
            showAerosol={showAerosol}
            showCoordinates={showCoordinates}
            showControls={showControls}
            rasterOpacity={rasterOpacity}
            onSatelliteSelectionChange={(payload) => setSelectedSatelliteNorad(payload?.norad ?? null)}
          />
        </Card>

        <Card className="panel">
          <PanelTitle
            eyebrow="LAYER MIX"
            title="Airkorea + WorldWind controls"
            tag={loadingAir ? "loading" : airDashboard.provider}
          />
          <div className="orbit-summary-grid">
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">PM2.5 avg</span>
              <strong>{airDashboard.summary.pm25Average ?? "-"}</strong>
              <span>전국 측정소 평균</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">PM10 avg</span>
              <strong>{airDashboard.summary.pm10Average ?? "-"}</strong>
              <span>전국 측정소 평균</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Bad+ stations</span>
              <strong>{airDashboard.summary.badStationCount ?? 0}</strong>
              <span>나쁨 이상 측정소</span>
            </div>
            <div className="orbit-summary-card">
              <span className="orbit-summary-card__label">Stations</span>
              <strong>{airDashboard.summary.stationCount ?? 0}</strong>
              <span>{airDashboard.updatedAt ?? "대기질 시각 없음"}</span>
            </div>
          </div>
          <div className="metric-list">
            <div className="metric-row">
              <div>
                <strong>NASA GIBS aerosol</strong>
                <span>한반도 주변 OMPS Aerosol Index NRT 요청 레이어 투명도</span>
              </div>
              <div className="metric-row__value">
                <span>{Math.round(rasterOpacity * 100)}%</span>
                <ProgressBar value={rasterOpacity} intent={Intent.PRIMARY} />
              </div>
            </div>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">레이어</span>
            <div className="segment-filter">
              <Button
                active={showTrueColor}
                minimal={!showTrueColor}
                onClick={() => setShowTrueColor((current) => !current)}
              >
                True color
              </Button>
              <Button active={showAerosol} minimal={!showAerosol} onClick={() => setShowAerosol((current) => !current)}>
                Aerosol
              </Button>
              <Button
                active={showSatellites}
                minimal={!showSatellites}
                onClick={() => setShowSatellites((current) => !current)}
              >
                Korean satellites
              </Button>
              <Button
                active={showCoordinates}
                minimal={!showCoordinates}
                onClick={() => setShowCoordinates((current) => !current)}
              >
                Coordinates
              </Button>
              <Button active={showControls} minimal={!showControls} onClick={() => setShowControls((current) => !current)}>
                Nav controls
              </Button>
            </div>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">Aerosol opacity</span>
            <input
              className="worldwind-slider"
              type="range"
              min="0.15"
              max="0.9"
              step="0.05"
              value={rasterOpacity}
              onChange={(event) => setRasterOpacity(Number(event.target.value))}
            />
          </div>
          <div className="orbit-source-status orbit-source-status--secondary">
            <span>{airDashboard.cachePolicy || "AirKorea cache unavailable"}</span>
            <span>{airDashboard.fetchedAt ? airDashboard.fetchedAt.slice(0, 19).replace("T", " ") : "No fetch yet"}</span>
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
                    NORAD {selectedSatellite.norad} · {selectedSatellite.launchDate ?? "Launch unknown"}
                  </span>
                </div>
                <div className="metric-row__value">
                  <span>{selectedSatellite.sourceLabel}</span>
                  <ProgressBar value={0.82} intent={Intent.SUCCESS} />
                </div>
              </div>
            ) : (
              <div className="orbit-empty-state">지구본 위 placemark 또는 아래 목록에서 한국 위성을 선택하면 상세를 보여준다.</div>
            )}
          </div>
          {error ? <div className="orbit-source-warning">{error}</div> : null}
          {airDashboard.warning ? <div className="orbit-source-warning">{airDashboard.warning}</div> : null}
        </Card>
      </section>

      <section className="panel-grid">
        <Card className="panel">
          <PanelTitle
            eyebrow="POLLUTION RANK"
            title="Top PM2.5 monitoring stations"
            tag={loadingAir ? "loading" : `${airDashboard.topPm25Stations.length} shown`}
          />
          <div className="data-list">
            {airDashboard.topPm25Stations.length > 0 ? (
              airDashboard.topPm25Stations.map((entry) => (
                <div key={`${entry.sidoName}-${entry.stationName}`} className="data-row">
                  <div>
                    <strong>{entry.stationName}</strong>
                    <span>
                      {entry.sidoName} · PM2.5 {entry.pm25Value ?? "-"} · PM10 {entry.pm10Value ?? "-"}
                    </span>
                  </div>
                  <Tag minimal round intent={Intent.DANGER}>
                    {entry.dataTime ?? "unknown"}
                  </Tag>
                </div>
              ))
            ) : (
              <div className="orbit-empty-state">DATA_GO_KR_SERVICE_KEY를 넣으면 AirKorea 실시간 측정소 상위 목록이 표시된다.</div>
            )}
          </div>
        </Card>

        <Card className="panel">
          <PanelTitle eyebrow="SIDO RANK" title="Regional PM2.5 averages" tag={`${airDashboard.bySido.length} regions`} />
          <div className="data-list">
            {airDashboard.bySido.length > 0 ? (
              airDashboard.bySido.slice(0, 10).map((entry) => (
                <div key={entry.sidoName} className="data-row">
                  <div>
                    <strong>{entry.sidoName}</strong>
                    <span>{entry.stationCount} stations</span>
                  </div>
                  <div className="list-row__meta">
                    <strong>PM2.5 {entry.pm25Average ?? "-"}</strong>
                    <span>PM10 {entry.pm10Average ?? "-"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="orbit-empty-state">서비스키를 넣으면 시도별 평균 대기질이 표시된다.</div>
            )}
          </div>
        </Card>
      </section>
    </>
  );
}

export function CountriesCasePanel() {
  return (
    <section className="panel-grid panel-grid--single">
      <Card className="panel panel--visual panel--visual-fullbleed">
        <div className="panel-visual__title">
          <PanelTitle eyebrow="2D TRACK MAP" title="한국 위성 트래킹" tag="Canvas + TopoJSON" />
        </div>
        <WorldCountriesDemo />
      </Card>
    </section>
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
