import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef, useState } from "react";
import * as satellite from "satellite.js";
import { fetchSatelliteFleet } from "../api";
import { computeState, getOrbitSamplingConfig, supportsEarthGlobeTrack } from "../lib/orbitMath";

const TOPOJSON_CLIENT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js";
const D3_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
const ANTARCTICA_CUTOFF_LATITUDE = -60;
const LONGITUDE_SHIFTS = [-360, 0, 360];
const MIN_SCALE = 1;
const MAX_SCALE = 12;
const TRACK_REFRESH_INTERVAL_MS = 5000;
const ORBIT_SOURCE_MODE_STORAGE_KEY = "pulse-desk:orbit-source-mode";
const HOME_LONGITUDE = 127.8;
const HOME_LATITUDE = 36.2;
const HOME_SCALE = 2.35;

let topojsonClientPromise;
let d3Promise;

function loadTopojsonClient() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("topojson-client is unavailable during SSR."));
  }

  if (window.topojson) {
    return Promise.resolve(window.topojson);
  }

  if (topojsonClientPromise) {
    return topojsonClientPromise;
  }

  topojsonClientPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-topojson-src="${TOPOJSON_CLIENT_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.topojson), { once: true });
      existing.addEventListener("error", () => reject(new Error("topojson-client failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TOPOJSON_CLIENT_SCRIPT_URL;
    script.async = true;
    script.dataset.topojsonSrc = TOPOJSON_CLIENT_SCRIPT_URL;
    script.onload = () => {
      if (window.topojson) {
        resolve(window.topojson);
        return;
      }

      reject(new Error("topojson-client did not expose a global object."));
    };
    script.onerror = () => reject(new Error("topojson-client failed to load."));
    document.head.appendChild(script);
  });

  return topojsonClientPromise;
}

function loadD3() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("d3 is unavailable during SSR."));
  }

  if (window.d3?.geoContains) {
    return Promise.resolve(window.d3);
  }

  if (d3Promise) {
    return d3Promise;
  }

  d3Promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-d3-src="${D3_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.d3), { once: true });
      existing.addEventListener("error", () => reject(new Error("d3 failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = D3_SCRIPT_URL;
    script.async = true;
    script.dataset.d3Src = D3_SCRIPT_URL;
    script.onload = () => {
      if (window.d3?.geoContains) {
        resolve(window.d3);
        return;
      }

      reject(new Error("d3 did not expose geoContains."));
    };
    script.onerror = () => reject(new Error("d3 failed to load."));
    document.head.appendChild(script);
  });

  return d3Promise;
}

function unwrapLine(coordinates) {
  if (coordinates.length === 0) {
    return [];
  }

  const unwrapped = [coordinates[0].slice()];

  for (let index = 1; index < coordinates.length; index += 1) {
    const [longitude, latitude] = coordinates[index];
    const previousLongitude = unwrapped[index - 1][0];
    let adjustedLongitude = longitude;

    while (adjustedLongitude - previousLongitude > 180) {
      adjustedLongitude -= 360;
    }

    while (adjustedLongitude - previousLongitude < -180) {
      adjustedLongitude += 360;
    }

    unwrapped.push([adjustedLongitude, latitude]);
  }

  return unwrapped;
}

function polygonMaxLatitude(polygonCoordinates) {
  let maxLatitude = -Infinity;

  polygonCoordinates.forEach((ring) => {
    ring.forEach(([, latitude]) => {
      if (latitude > maxLatitude) {
        maxLatitude = latitude;
      }
    });
  });

  return maxLatitude;
}

function filterPolygons(features, hideAntarctica) {
  if (!hideAntarctica) {
    return features;
  }

  return features.filter((feature) => {
    if (feature.geometry.type === "Polygon") {
      return polygonMaxLatitude(feature.geometry.coordinates) >= ANTARCTICA_CUTOFF_LATITUDE;
    }

    if (feature.geometry.type === "MultiPolygon") {
      return feature.geometry.coordinates.some((polygon) => polygonMaxLatitude(polygon) >= ANTARCTICA_CUTOFF_LATITUDE);
    }

    return true;
  });
}

function formatCoordinate(value, positiveSuffix, negativeSuffix) {
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix;
  return `${Math.abs(value).toFixed(2)}°${suffix}`;
}

function getHomeViewState(metrics) {
  if (!metrics) {
    return { scale: HOME_SCALE, offsetX: 0, offsetY: 0 };
  }

  const baseX = ((HOME_LONGITUDE + 180) / 360) * metrics.viewportWidth;
  const baseY = ((90 - HOME_LATITUDE) / 180) * metrics.viewportHeight;
  const centeredX = baseX - metrics.viewportWidth / 2;
  const centeredY = baseY - metrics.viewportHeight / 2;

  return {
    scale: HOME_SCALE,
    offsetX: -centeredX * HOME_SCALE,
    offsetY: -centeredY * HOME_SCALE,
  };
}

function rectanglesOverlap(left, right) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function rectFitsViewport(rect, metrics) {
  return (
    rect.x >= metrics.viewportX &&
    rect.y >= metrics.viewportY &&
    rect.x + rect.width <= metrics.viewportX + metrics.viewportWidth &&
    rect.y + rect.height <= metrics.viewportY + metrics.viewportHeight
  );
}

function findLabelPlacement(anchorX, anchorY, labelWidth, labelHeight, metrics, occupiedLabelRects) {
  const candidateOffsets = [
    { dx: 10, dy: -labelHeight - 8 },
    { dx: 10, dy: 8 },
    { dx: -labelWidth - 10, dy: -labelHeight - 8 },
    { dx: -labelWidth - 10, dy: 8 },
    { dx: -labelWidth / 2, dy: -labelHeight - 12 },
    { dx: -labelWidth / 2, dy: 12 },
    { dx: 14, dy: -labelHeight / 2 },
    { dx: -labelWidth - 14, dy: -labelHeight / 2 },
  ];

  for (let radius = 0; radius <= 160; radius += 18) {
    for (const offset of candidateOffsets) {
      const rect = {
        x: anchorX + offset.dx + (offset.dx >= 0 ? radius : -radius),
        y: anchorY + offset.dy,
        width: labelWidth,
        height: labelHeight,
      };

      if (!rectFitsViewport(rect, metrics)) {
        continue;
      }

      if (!occupiedLabelRects.some((occupiedRect) => rectanglesOverlap(rect, occupiedRect))) {
        return rect;
      }
    }
  }

  return null;
}

function buildGroundTrackSamples(fleet, date) {
  return fleet
    .map((item) => {
      try {
        const satrec = item.omm
          ? satellite.json2satrec(item.omm)
          : satellite.twoline2satrec(item.tle[0], item.tle[1]);
        const current = computeState(satellite, satrec, date);
        if (!current) {
          return null;
        }

        const { halfWindowMinutes, sampleStepMinutes } = getOrbitSamplingConfig(item);
        const track = [];

        for (let minute = -halfWindowMinutes; minute <= halfWindowMinutes; minute += sampleStepMinutes) {
          const sampleDate = new Date(date.getTime() + minute * 60000);
          const state = computeState(satellite, satrec, sampleDate);
          if (!state) {
            continue;
          }

          track.push([state.longitude, state.latitude]);
        }

        if (track.length < 2) {
          return null;
        }

        return {
          norad: item.norad,
          name: item.englishName ?? item.name,
          color: item.color ?? "#9bc6ff",
          orbitClass: item.orbitClass,
          current,
          track,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export default function WorldCountriesDemo() {
  const canvasRef = useRef(null);
  const currentDataRef = useRef(null);
  const renderedFeaturesRef = useRef([]);
  const trackOverlayRef = useRef([]);
  const requestTokenRef = useRef(0);
  const dragStateRef = useRef(null);
  const viewStateRef = useRef({ scale: HOME_SCALE, offsetX: 0, offsetY: 0 });
  const d3Ref = useRef(null);

  const [resolution, setResolution] = useState("50m");
  const [hideAntarctica, setHideAntarctica] = useState(true);
  const [showGeoTracks, setShowGeoTracks] = useState(true);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [fleetStatus, setFleetStatus] = useState("fleet: loading");
  const [countrySummary, setCountrySummary] = useState("countries: -");
  const [bboxSummary, setBboxSummary] = useState("bbox: -");
  const [trackSummary, setTrackSummary] = useState("tracks: -");
  const [countryHover, setCountryHover] = useState("country: -");
  const [cursorSummary, setCursorSummary] = useState("cursor: -");
  const [viewSummary, setViewSummary] = useState("view: 1.00x, dx=0, dy=0");
  const [dragging, setDragging] = useState(false);
  const isBootstrapping =
    status.startsWith("loading") ||
    fleetStatus.startsWith("fleet: loading") ||
    (!currentDataRef.current && !error);

  function getCanvasMetrics() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const viewportWidth = Math.min(width, height * 2);
    const viewportHeight = viewportWidth / 2;
    const viewportX = (width - viewportWidth) / 2;
    const viewportY = (height - viewportHeight) / 2;

    return {
      canvas,
      width,
      height,
      viewportWidth,
      viewportHeight,
      viewportX,
      viewportY,
    };
  }

  function project([longitude, latitude], metrics) {
    const { scale, offsetX, offsetY } = viewStateRef.current;
    const baseX = ((longitude + 180) / 360) * metrics.viewportWidth;
    const baseY = ((90 - latitude) / 180) * metrics.viewportHeight;
    const centeredX = baseX - metrics.viewportWidth / 2;
    const centeredY = baseY - metrics.viewportHeight / 2;

    return [
      metrics.viewportX + metrics.viewportWidth / 2 + centeredX * scale + offsetX,
      metrics.viewportY + metrics.viewportHeight / 2 + centeredY * scale + offsetY,
    ];
  }

  function unproject(x, y, metrics) {
    if (
      x < metrics.viewportX ||
      x > metrics.viewportX + metrics.viewportWidth ||
      y < metrics.viewportY ||
      y > metrics.viewportY + metrics.viewportHeight
    ) {
      return null;
    }

    const { scale, offsetX, offsetY } = viewStateRef.current;
    const baseX =
      (x - metrics.viewportX - metrics.viewportWidth / 2 - offsetX) / scale + metrics.viewportWidth / 2;
    const baseY =
      (y - metrics.viewportY - metrics.viewportHeight / 2 - offsetY) / scale + metrics.viewportHeight / 2;

    return [(baseX / metrics.viewportWidth) * 360 - 180, 90 - (baseY / metrics.viewportHeight) * 180];
  }

  function setViewSummaryText() {
    const { scale, offsetX, offsetY } = viewStateRef.current;
    setViewSummary(`view: ${scale.toFixed(2)}x, dx=${offsetX.toFixed(0)}, dy=${offsetY.toFixed(0)}`);
  }

  function resizeCanvas() {
    const metrics = getCanvasMetrics();
    if (!metrics) {
      return null;
    }

    const ratio = window.devicePixelRatio || 1;
    metrics.canvas.width = Math.round(metrics.width * ratio);
    metrics.canvas.height = Math.round(metrics.height * ratio);

    const context = metrics.canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ...metrics, context };
  }

  function drawGrid(context, metrics) {
    context.save();
    context.beginPath();
    context.rect(metrics.viewportX, metrics.viewportY, metrics.viewportWidth, metrics.viewportHeight);
    context.clip();
    context.strokeStyle = "rgba(141, 175, 215, 0.18)";
    context.lineWidth = 1;

    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const [x] = project([longitude, 0], metrics);
      context.beginPath();
      context.moveTo(x, metrics.viewportY);
      context.lineTo(x, metrics.viewportY + metrics.viewportHeight);
      context.stroke();
    }

    for (let latitude = -90; latitude <= 90; latitude += 30) {
      const [, y] = project([0, latitude], metrics);
      context.beginPath();
      context.moveTo(metrics.viewportX, y);
      context.lineTo(metrics.viewportX + metrics.viewportWidth, y);
      context.stroke();
    }

    context.restore();
  }

  function drawPolygonRings(context, rings, metrics, longitudeShift) {
    rings.forEach((ring) => {
      const unwrapped = unwrapLine(ring);

      unwrapped.forEach((point, pointIndex) => {
        const [x, y] = project([point[0] + longitudeShift, point[1]], metrics);
        if (pointIndex === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });

      context.closePath();
    });
  }

  function drawLineString(context, coordinates, metrics, longitudeShift) {
    const unwrapped = unwrapLine(coordinates);

    unwrapped.forEach((point, pointIndex) => {
      const [x, y] = project([point[0] + longitudeShift, point[1]], metrics);
      if (pointIndex === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
  }

  function drawCountries(context, metrics, countryFeatures) {
    context.save();
    context.beginPath();
    context.rect(metrics.viewportX, metrics.viewportY, metrics.viewportWidth, metrics.viewportHeight);
    context.clip();
    context.fillStyle = "rgba(78, 142, 113, 0.8)";
    context.strokeStyle = "rgba(16, 35, 26, 0.82)";
    context.lineWidth = 0.55;

    countryFeatures.forEach((feature) => {
      const { geometry } = feature;

      LONGITUDE_SHIFTS.forEach((longitudeShift) => {
        context.beginPath();

        if (geometry.type === "Polygon") {
          drawPolygonRings(context, geometry.coordinates, metrics, longitudeShift);
        }

        if (geometry.type === "MultiPolygon") {
          geometry.coordinates.forEach((polygon) => {
            drawPolygonRings(context, polygon, metrics, longitudeShift);
          });
        }

        context.fill("evenodd");
      });
    });

    context.restore();
  }

  function drawBorders(context, metrics, borderMesh) {
    context.save();
    context.beginPath();
    context.rect(metrics.viewportX, metrics.viewportY, metrics.viewportWidth, metrics.viewportHeight);
    context.clip();
    context.strokeStyle = "rgba(12, 24, 18, 0.95)";
    context.lineWidth = 0.65;

    LONGITUDE_SHIFTS.forEach((longitudeShift) => {
      context.beginPath();

      if (borderMesh.type === "MultiLineString") {
        borderMesh.coordinates.forEach((line) => {
          drawLineString(context, line, metrics, longitudeShift);
        });
      } else if (borderMesh.type === "LineString") {
        drawLineString(context, borderMesh.coordinates, metrics, longitudeShift);
      }

      context.stroke();
    });

    context.restore();
  }

  function drawSatelliteTracks(context, metrics) {
    const overlays = trackOverlayRef.current;
    if (overlays.length === 0) {
      return;
    }

    context.save();
    context.beginPath();
    context.rect(metrics.viewportX, metrics.viewportY, metrics.viewportWidth, metrics.viewportHeight);
    context.clip();
    const occupiedLabelRects = [];

    for (const overlay of overlays) {
      context.strokeStyle = overlay.color;
      context.lineWidth = overlay.orbitClass === "geo" ? 1.6 : 1.1;
      context.globalAlpha = overlay.orbitClass === "geo" ? 0.42 : 0.28;

      for (const longitudeShift of LONGITUDE_SHIFTS) {
        context.beginPath();
        drawLineString(context, overlay.track, metrics, longitudeShift);
        context.stroke();

        const [x, y] = project([overlay.current.longitude + longitudeShift, overlay.current.latitude], metrics);
        context.globalAlpha = 1;
        context.fillStyle = overlay.color;
        context.beginPath();
        context.arc(x, y, overlay.orbitClass === "geo" ? 5.8 : 4.9, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(245, 251, 255, 0.9)";
        context.lineWidth = 1.6;
        context.stroke();

        const label = overlay.name ?? `NORAD ${overlay.norad}`;
        context.font = '12px "IBM Plex Sans", "Noto Sans KR", sans-serif';
        const labelWidth = context.measureText(label).width + 10;
        const labelHeight = 18;
        const labelBackground = overlay.orbitClass === "geo" ? "rgba(96, 104, 115, 0.84)" : "rgba(4, 17, 29, 0.84)";
        const labelRect = findLabelPlacement(x, y, labelWidth, labelHeight, metrics, occupiedLabelRects);

        if (labelRect) {
          occupiedLabelRects.push(labelRect);
          context.fillStyle = labelBackground;
          context.fillRect(labelRect.x, labelRect.y, labelRect.width, labelRect.height);
          context.fillStyle = "#f5fbff";
          context.fillText(label, labelRect.x + 5, labelRect.y + 13);
        }

        context.globalAlpha = overlay.orbitClass === "geo" ? 0.42 : 0.28;
      }
    }

    context.restore();
  }

  function renderMap() {
    const nextData = currentDataRef.current;
    if (!nextData) {
      return;
    }

    const resized = resizeCanvas();
    if (!resized) {
      return;
    }

    const { context, width, height, viewportX, viewportY, viewportWidth, viewportHeight } = resized;
    const filteredCountries = filterPolygons(nextData.countries.features, hideAntarctica);

    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(7, 18, 28, 0.98)";
    context.fillRect(0, 0, width, height);

    const background = context.createLinearGradient(0, viewportY, 0, viewportY + viewportHeight);
    background.addColorStop(0, "#cbe3f1");
    background.addColorStop(0.55, "#8bbad3");
    background.addColorStop(1, "#5d88a2");
    context.fillStyle = background;
    context.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);

    drawGrid(context, resized);
    drawCountries(context, resized, filteredCountries);
    drawBorders(context, resized, nextData.borderMesh);
    drawSatelliteTracks(context, resized);

    renderedFeaturesRef.current = filteredCountries;
    setCountrySummary(`countries: ${filteredCountries.length}/${nextData.countries.features.length}`);
    setBboxSummary(`bbox: ${nextData.bbox.join(", ")}`);
    setViewSummaryText();
  }

  function findCountryAt(longitude, latitude) {
    const d3 = d3Ref.current;
    if (!d3?.geoContains) {
      return null;
    }

    return renderedFeaturesRef.current.find((feature) => d3.geoContains(feature, [longitude, latitude])) ?? null;
  }

  function zoomAtPoint(nextScale, anchorX, anchorY) {
    const metrics = getCanvasMetrics();
    if (!metrics) {
      return;
    }

    const previousScale = viewStateRef.current.scale;
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (clampedScale === previousScale) {
      return;
    }

    const baseX = (anchorX - metrics.viewportX - metrics.viewportWidth / 2 - viewStateRef.current.offsetX) / previousScale;
    const baseY = (anchorY - metrics.viewportY - metrics.viewportHeight / 2 - viewStateRef.current.offsetY) / previousScale;

    viewStateRef.current = {
      scale: clampedScale,
      offsetX: anchorX - metrics.viewportX - metrics.viewportWidth / 2 - baseX * clampedScale,
      offsetY: anchorY - metrics.viewportY - metrics.viewportHeight / 2 - baseY * clampedScale,
    };

    renderMap();
  }

  function resetView() {
    viewStateRef.current = getHomeViewState(getCanvasMetrics());
    renderMap();
  }

  async function loadWorldAtlas() {
    const requestToken = ++requestTokenRef.current;
    viewStateRef.current = getHomeViewState(getCanvasMetrics());
    setStatus(`loading ${resolution}`);
    setError("");

    try {
      const d3 = await loadD3();
      const topojson = await loadTopojsonClient();
      const response = await fetch(`https://cdn.jsdelivr.net/npm/world-atlas@2/countries-${resolution}.json`, {
        mode: "cors",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const topology = await response.json();
      if (requestToken !== requestTokenRef.current) {
        return;
      }

      d3Ref.current = d3;
      currentDataRef.current = {
        bbox: topology.bbox || [-180, -90, 180, 90],
        countries: topojson.feature(topology, topology.objects.countries),
        borderMesh: topojson.mesh(topology, topology.objects.countries, (left, right) => left !== right),
      };

      renderMap();
      setStatus(`ready ${resolution}`);
    } catch (loadError) {
      if (requestToken !== requestTokenRef.current) {
        return;
      }

      currentDataRef.current = null;
      renderedFeaturesRef.current = [];
      setCountrySummary("countries: -");
      setBboxSummary("bbox: -");
      setCountryHover("country: -");
      setCursorSummary("cursor: -");
      setError(loadError.message);
      setStatus("load failed");
    }
  }

  function updateHoverState(clientX, clientY) {
    const metrics = getCanvasMetrics();
    if (!metrics) {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const point = unproject(x, y, metrics);
    if (!point) {
      setCursorSummary("cursor: -");
      setCountryHover("country: -");
      return;
    }
    const [longitude, latitude] = point;
    const hoveredCountry = findCountryAt(longitude, latitude);

    setCursorSummary(
      `cursor: x=${x.toFixed(1)}, y=${y.toFixed(1)} | lon=${formatCoordinate(longitude, "E", "W")}, lat=${formatCoordinate(latitude, "N", "S")}`,
    );
    setCountryHover(
      `country: ${hoveredCountry ? hoveredCountry.properties?.name || `ISO ${hoveredCountry.id}` : "-"}`,
    );
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const zoomFactor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomAtPoint(viewStateRef.current.scale * zoomFactor, anchorX, anchorY);
    updateHoverState(event.clientX, event.clientY);
  }

  function handlePointerDown(event) {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: viewStateRef.current.offsetX,
      offsetY: viewStateRef.current.offsetY,
    };
    setDragging(true);
  }

  function handlePointerMove(event) {
    if (dragStateRef.current) {
      viewStateRef.current = {
        ...viewStateRef.current,
        offsetX: dragStateRef.current.offsetX + (event.clientX - dragStateRef.current.startX),
        offsetY: dragStateRef.current.offsetY + (event.clientY - dragStateRef.current.startY),
      };
      renderMap();
    }

    updateHoverState(event.clientX, event.clientY);
  }

  function handlePointerLeave() {
    dragStateRef.current = null;
    setDragging(false);
    setCountryHover("country: -");
    setCursorSummary("cursor: -");
  }

  useEffect(() => {
    loadWorldAtlas();
  }, [resolution]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const storedMode =
      typeof window === "undefined" ? "snapshot" : window.localStorage.getItem(ORBIT_SOURCE_MODE_STORAGE_KEY) === "live" ? "live" : "snapshot";

    async function loadFleet() {
      setFleetStatus(`fleet: loading ${storedMode}`);

      try {
        const payload = await fetchSatelliteFleet(storedMode);
        if (cancelled) {
          return;
        }

        const trackableFleet = payload.fleet.filter(
          (item) =>
            supportsEarthGlobeTrack(item) &&
            (showGeoTracks || item.orbitClass !== "geo") &&
            (item.omm || (Array.isArray(item.tle) && item.tle.length >= 2)),
        );

        function refreshTracks() {
          const overlays = buildGroundTrackSamples(trackableFleet, new Date());
          trackOverlayRef.current = overlays;
          setTrackSummary(`tracks: ${overlays.length}`);
          renderMap();
        }

        refreshTracks();
        timer = window.setInterval(refreshTracks, TRACK_REFRESH_INTERVAL_MS);

        setFleetStatus(
          `fleet: ${trackableFleet.length} sats · ${payload.provider}${payload.updatedAt ? ` · ${payload.updatedAt.slice(11, 19)}` : ""}`,
        );
      } catch (fleetError) {
        if (cancelled) {
          return;
        }

        if (trackOverlayRef.current.length === 0) {
          setTrackSummary("tracks: -");
          setFleetStatus("fleet: unavailable");
        } else {
          setTrackSummary(`tracks: ${trackOverlayRef.current.length}`);
          setFleetStatus("fleet: cached fallback");
        }
        setError((current) => current || fleetError.message);
        renderMap();
      }
    }

    loadFleet();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [showGeoTracks]);

  useEffect(() => {
    renderMap();
  }, [hideAntarctica]);

  useEffect(() => {
    function handleResize() {
      renderMap();
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      setDragging(false);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div className="countries-demo">
      <div className="countries-demo__frame">
        <canvas
          ref={canvasRef}
          className={`countries-demo__canvas ${dragging ? "countries-demo__canvas--dragging" : ""}`}
          aria-label="세계 국가 경계 지도"
          onWheel={handleWheel}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseLeave={handlePointerLeave}
        />
        {isBootstrapping ? (
          <div className="countries-demo__loading">
            <div className="countries-demo__loading-icon" aria-hidden="true">
              <Icon icon={IconNames.SATELLITE} size={24} />
            </div>
            <strong>위성 궤적과 세계 지도를 불러오는 중</strong>
            <span>국가 경계, 한국 위성 궤적, hover 데이터를 차례로 준비하고 있다.</span>
          </div>
        ) : null}
      </div>

      <div className="countries-demo__hud">
        <div className="countries-demo__toolbar">
          <label className="countries-demo__control">
            <span>해상도</span>
            <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
              <option value="110m">110m</option>
              <option value="50m">50m</option>
              <option value="10m">10m</option>
            </select>
          </label>

          <label className="countries-demo__control countries-demo__control--toggle">
            <input
              type="checkbox"
              checked={hideAntarctica}
              onChange={(event) => setHideAntarctica(event.target.checked)}
            />
            <span>남극권 숨김</span>
          </label>

          <label className="countries-demo__control countries-demo__control--toggle">
            <input
              type="checkbox"
              checked={showGeoTracks}
              onChange={(event) => setShowGeoTracks(event.target.checked)}
            />
            <span>GEO 표시</span>
          </label>

          <div className="countries-demo__actions">
            <button
              type="button"
              onClick={() => {
                const metrics = getCanvasMetrics();
                if (!metrics) {
                  return;
                }

                zoomAtPoint(
                  viewStateRef.current.scale * 1.25,
                  metrics.viewportX + metrics.viewportWidth / 2,
                  metrics.viewportY + metrics.viewportHeight / 2,
                );
              }}
            >
              Zoom in
            </button>
            <button
              type="button"
              onClick={() => {
                const metrics = getCanvasMetrics();
                if (!metrics) {
                  return;
                }

                zoomAtPoint(
                  viewStateRef.current.scale / 1.25,
                  metrics.viewportX + metrics.viewportWidth / 2,
                  metrics.viewportY + metrics.viewportHeight / 2,
                );
              }}
            >
              Zoom out
            </button>
            <button type="button" onClick={resetView}>
              Reset
            </button>
          </div>
        </div>

        <div className="countries-demo__meta">
          <span>{`status: ${status}`}</span>
          <span>{fleetStatus}</span>
          <span>{countrySummary}</span>
          <span>{bboxSummary}</span>
          <span>{trackSummary}</span>
          <span>{countryHover}</span>
          <span>{cursorSummary}</span>
          <span>{viewSummary}</span>
        </div>

        {error ? <div className="countries-demo__error">{error}</div> : null}
      </div>
    </div>
  );
}
