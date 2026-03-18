import { Button, Card, Intent, ProgressBar, Tag, Tooltip } from "@blueprintjs/core";
import { useEffect, useMemo, useState } from "react";
import { fetchLeoBackdrop, fetchSatelliteFleet } from "../api";
import CesiumOrbitDemo, { orbitFleet } from "./CesiumOrbitDemo";

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
    label: "snapshot",
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
  const [fleet, setFleet] = useState(orbitFleet);
  const [sourceMeta, setSourceMeta] = useState({
    provider: "Bundled snapshot",
    isFallback: false,
    warning: "",
    updatedAt: null,
    freshnessLabel: "bundled",
    cachePolicy: "Static snapshot",
  });
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [showGlobalLeo, setShowGlobalLeo] = useState(true);
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

        setFleet(orbitFleet);
        setSourceMeta({
          provider: "Bundled snapshot",
          isFallback: true,
          warning: error.message,
          updatedAt: null,
          freshnessLabel: "bundled",
          cachePolicy: "Static snapshot",
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

  const filteredFleet = useMemo(
    () =>
      fleet.filter((item) => {
        const matchesOrbit = orbitFilter === "all" || item.orbitClass === orbitFilter;
        const matchesMission = missionFilter === "all" || item.missionType === missionFilter;
        return matchesOrbit && matchesMission;
      }),
    [fleet, orbitFilter, missionFilter],
  );
  const visibleNames = useMemo(
    () => new Set(filteredFleet.map((item) => item.name)),
    [filteredFleet],
  );
  const renderedFleet = useMemo(
    () => (telemetry.length > 0 ? telemetry : fleet).filter((entry) => visibleNames.has(entry.name)),
    [fleet, telemetry, visibleNames],
  );
  const trackedCountLabel =
    filteredFleet.length === fleet.length ? `${filteredFleet.length} sats` : `${filteredFleet.length}/${fleet.length} sats`;
  const visibleLeoPoints = showGlobalLeo ? leoBackdrop.points : [];

  return (
    <>
      <section className="panel-grid panel-grid--hero">
        <Card className="panel panel--visual panel--visual-fullbleed">
          <div className="panel-visual__title">
            <PanelTitle eyebrow="CESIUM CASE" title="Korea tracks + global LEO points" tag="Path + Point cloud" />
          </div>
          <CesiumOrbitDemo
            fleet={filteredFleet}
            leoPoints={visibleLeoPoints}
            onTelemetryChange={setTelemetry}
            onPointSelectionChange={setSelectedLeoPoint}
          />
        </Card>

        <Card className="panel">
          <PanelTitle
            eyebrow="KOREA TRACKING"
            title="Telemetry + overlay status"
            tag={sourceMode === "live" ? `Cached OMM · ${trackedCountLabel}` : `Snapshot · ${trackedCountLabel}`}
          />
          <div className="segment-filter orbit-source-filter">
            <Button
              active={sourceMode === "snapshot"}
              minimal={sourceMode !== "snapshot"}
              onClick={() => setSourceMode("snapshot")}
            >
              하드코딩
            </Button>
            <Button
              active={sourceMode === "live"}
              minimal={sourceMode !== "live"}
              loading={loadingFleet && sourceMode === "live"}
              onClick={() => setSourceMode("live")}
            >
              최신 캐시값
            </Button>
          </div>
          <div className="orbit-filter-group">
            <span className="orbit-filter-group__label">표시 범위</span>
            <div className="segment-filter">
              <Button active={!showGlobalLeo} minimal={showGlobalLeo} onClick={() => setShowGlobalLeo(false)}>
                대한민국 위성만
              </Button>
              <Button active={showGlobalLeo} minimal={!showGlobalLeo} onClick={() => setShowGlobalLeo(true)}>
                전체 LEO 포함
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
            <span>{sourceMeta.updatedAt ? sourceMeta.updatedAt.slice(0, 19).replace("T", " ") : "local snapshot"}</span>
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
          <div className="metric-list">
            {renderedFleet.length > 0 ? (
              renderedFleet.map((entry) => (
                <div key={entry.name} className="metric-row">
                  <div>
                    <strong className="orbit-entry-title">
                      <span>{entry.name}</span>
                      <OrbitSourceStateTag sourceState={entry.sourceState} />
                    </strong>
                    <span>{buildOrbitMetaLine(entry)}</span>
                    <span>
                      NORAD {entry.norad} · {entry.sourceDate ?? "snapshot"}
                    </span>
                  </div>
                  <div className="metric-row__value">
                    <span>{entry.altitude ?? entry.sourceLabel}</span>
                    <ProgressBar
                      value={
                        entry.altitude
                          ? Math.min(Number.parseInt(entry.altitude, 10) / 1000, 1)
                          : 0.72
                      }
                      intent={Intent.PRIMARY}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="orbit-empty-state">선택한 필터에 맞는 위성이 없다.</div>
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
              <div className="orbit-empty-state">지구본 위 점을 클릭하면 선택한 위성의 현재 위치를 보여준다.</div>
            )}
          </div>
        </Card>
      </section>

      <section className="panel-grid">
        <Card className="panel">
          <PanelTitle eyebrow="WHY THIS CASE" title="CesiumJS fits orbital tracking" tag="3D Globe" />
          <div className="explain-list">
            <p>`Entity`, `PathGraphics`, `Timeline`으로 이동 경로와 시간축을 자연스럽게 다룰 수 있다.</p>
            <p>대한민국 상업위성 7기는 기존처럼 궤적과 라벨을 유지하고, 그 외 LEO 위성은 저부하 점 레이어로만 표시한다.</p>
            <p>LEO 전체 원본 GP는 서버가 장주기 캐시하고, 현재 위치 점은 10초 스냅샷으로 재계산해 프런트 부하를 줄인다.</p>
            <p>우측 패널은 한국 위성 중심으로 유지하고, 다른 위성은 지구본 위 점을 클릭했을 때만 현재 위치를 읽도록 설계했다.</p>
            <p>카메라 패닝, 줌, 서울 기준 홈 이동을 같이 제공해서 분석 흐름을 끊지 않도록 구성했다.</p>
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
