import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as satellite from "satellite.js";

const WORLDWIND_SCRIPT_URL = "https://files.worldwind.arc.nasa.gov/artifactory/web/0.9.0/worldwind.min.js";
const GIBS_ENDPOINT_MODE = "nrt";
const GIBS_WMS_URL = `https://gibs.earthdata.nasa.gov/wms/epsg4326/${GIBS_ENDPOINT_MODE}/wms.cgi`;
const HOME_LATITUDE = 36.2;
const HOME_LONGITUDE = 127.8;
const HOME_RANGE = 3_200_000;
const WORLD_BOUNDS = {
  minLatitude: -90,
  maxLatitude: 90,
  minLongitude: -180,
  maxLongitude: 180,
};
const OVERLAY_BOUNDS = {
  minLatitude: 30,
  maxLatitude: 42,
  minLongitude: 118,
  maxLongitude: 138,
};

let worldwindLoaderPromise;

function loadWorldWind() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("WorldWind is unavailable during SSR."));
  }

  if (window.WorldWind) {
    return Promise.resolve(window.WorldWind);
  }

  if (worldwindLoaderPromise) {
    return worldwindLoaderPromise;
  }

  worldwindLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-worldwind-src="${WORLDWIND_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.WorldWind), { once: true });
      existing.addEventListener("error", () => reject(new Error("NASA WebWorldWind failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = WORLDWIND_SCRIPT_URL;
    script.async = true;
    script.dataset.worldwindSrc = WORLDWIND_SCRIPT_URL;
    script.onload = () => {
      if (window.WorldWind) {
        resolve(window.WorldWind);
        return;
      }

      reject(new Error("NASA WebWorldWind did not expose a global object."));
    };
    script.onerror = () => reject(new Error("NASA WebWorldWind failed to load."));
    document.head.appendChild(script);
  });

  return worldwindLoaderPromise;
}

function buildGibsGetMapUrl({ layer, format, transparent, width, height, bounds, time }) {
  const query = new URLSearchParams({
    service: "WMS",
    request: "GetMap",
    version: "1.3.0",
    crs: "EPSG:4326",
    styles: "",
    layers: layer,
    format,
    transparent: transparent ? "true" : "false",
    width: String(width),
    height: String(height),
    bbox: [bounds.minLatitude, bounds.minLongitude, bounds.maxLatitude, bounds.maxLongitude].join(","),
  });

  if (time) {
    query.set("time", time);
  }

  return `${GIBS_WMS_URL}?${query.toString()}`;
}

function normalizeDegrees(value, type) {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  const suffix = type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}° ${suffix}`;
}

function computeFleetPositions(fleet) {
  const now = new Date();

  return fleet
    .map((item) => {
      try {
        let satrec;

        if (item.omm) {
          satrec = satellite.json2satrec(item.omm);
        } else if (Array.isArray(item.tle) && item.tle.length >= 2) {
          satrec = satellite.twoline2satrec(item.tle[0], item.tle[1]);
        } else {
          return null;
        }

        const propagated = satellite.propagate(satrec, now);
        if (!propagated?.position) {
          return null;
        }

        const gmst = satellite.gstime(now);
        const geodetic = satellite.eciToGeodetic(propagated.position, gmst);

        return {
          ...item,
          latitude: satellite.degreesLat(geodetic.latitude),
          longitude: satellite.degreesLong(geodetic.longitude),
          altitudeKm: Math.round(geodetic.height),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export default function WorldWindRasterDemo({
  fleet,
  selectedNorad,
  showSatellites,
  showTrueColor,
  showAerosol,
  showCoordinates,
  showControls,
  rasterOpacity,
  onSatelliteSelectionChange,
}) {
  const requestedDataDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const canvasId = useId().replace(/:/g, "-");
  const hostRef = useRef(null);
  const worldWindowRef = useRef(null);
  const selectionCallbackRef = useRef(onSatelliteSelectionChange);
  const layersRef = useRef({
    trueColor: null,
    aerosol: null,
    satellites: null,
    coordinates: null,
    controls: null,
  });
  const placemarksRef = useRef(new Map());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const positionedFleet = useMemo(() => computeFleetPositions(fleet), [fleet]);

  useEffect(() => {
    selectionCallbackRef.current = onSatelliteSelectionChange;
  }, [onSatelliteSelectionChange]);

  useEffect(() => {
    let cancelled = false;

    async function initWorldWind() {
      try {
        const WorldWind = await loadWorldWind();
        if (cancelled || !hostRef.current) {
          return;
        }

        const wwd = new WorldWind.WorldWindow(canvasId);
        worldWindowRef.current = wwd;

        WorldWind.configuration.baseUrl = `${WORLDWIND_SCRIPT_URL.replace("worldwind.min.js", "")}`;

        const baseLayer = new WorldWind.BMNGOneImageLayer();
        const compassLayer = new WorldWind.CompassLayer();
        const coordinatesLayer = new WorldWind.CoordinatesDisplayLayer(wwd);
        const controlsLayer = new WorldWind.ViewControlsLayer(wwd);
        const trueColorLayer = new WorldWind.RenderableLayer("NASA GIBS True Color");
        const aerosolLayer = new WorldWind.RenderableLayer("NASA GIBS Aerosol");
        const satelliteLayer = new WorldWind.RenderableLayer("Korean satellites");

        coordinatesLayer.enabled = showCoordinates;
        controlsLayer.enabled = showControls;
        trueColorLayer.enabled = showTrueColor;
        aerosolLayer.enabled = showAerosol;
        satelliteLayer.enabled = showSatellites;

        wwd.addLayer(baseLayer);
        wwd.addLayer(compassLayer);
        wwd.addLayer(coordinatesLayer);
        wwd.addLayer(controlsLayer);
        wwd.addLayer(trueColorLayer);
        wwd.addLayer(aerosolLayer);
        wwd.addLayer(satelliteLayer);

        layersRef.current = {
          trueColor: trueColorLayer,
          aerosol: aerosolLayer,
          satellites: satelliteLayer,
          coordinates: coordinatesLayer,
          controls: controlsLayer,
        };

        const worldSector = new WorldWind.Sector(
          WORLD_BOUNDS.minLatitude,
          WORLD_BOUNDS.maxLatitude,
          WORLD_BOUNDS.minLongitude,
          WORLD_BOUNDS.maxLongitude,
        );
        const overlaySector = new WorldWind.Sector(
          OVERLAY_BOUNDS.minLatitude,
          OVERLAY_BOUNDS.maxLatitude,
          OVERLAY_BOUNDS.minLongitude,
          OVERLAY_BOUNDS.maxLongitude,
        );

        trueColorLayer.addRenderable(
          new WorldWind.SurfaceImage(
            worldSector,
            buildGibsGetMapUrl({
              layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
              format: "image/jpeg",
              transparent: false,
              width: 4096,
              height: 2048,
              bounds: WORLD_BOUNDS,
              time: requestedDataDate,
            }),
          ),
        );
        aerosolLayer.opacity = rasterOpacity;
        aerosolLayer.addRenderable(
          new WorldWind.SurfaceImage(
            overlaySector,
            buildGibsGetMapUrl({
              layer: "OMPS_Aerosol_Index",
              format: "image/png",
              transparent: true,
              width: 1600,
              height: 900,
              bounds: OVERLAY_BOUNDS,
              time: requestedDataDate,
            }),
          ),
        );

        wwd.navigator.lookAtLocation.latitude = HOME_LATITUDE;
        wwd.navigator.lookAtLocation.longitude = HOME_LONGITUDE;
        wwd.navigator.range = HOME_RANGE;

        new WorldWind.ClickRecognizer(wwd, (recognizer) => {
          const pickList = wwd.pick(wwd.canvasCoordinates(recognizer.clientX, recognizer.clientY));
          const picked = pickList.objects.find((entry) => entry.userObject?.userProperties?.norad);

          selectionCallbackRef.current?.(picked?.userObject?.userProperties ?? null);
        });

        setStatus("ready");
        setError("");
      } catch (nextError) {
        if (!cancelled) {
          setStatus("error");
          setError(nextError.message);
        }
      }
    }

    initWorldWind();

    return () => {
      cancelled = true;
      placemarksRef.current.clear();
      if (worldWindowRef.current) {
        worldWindowRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const wwd = worldWindowRef.current;
    const satelliteLayer = layersRef.current.satellites;
    const trueColorLayer = layersRef.current.trueColor;
    const aerosolLayer = layersRef.current.aerosol;
    if (!wwd || !satelliteLayer || !trueColorLayer || !aerosolLayer || !window.WorldWind) {
      return;
    }

    const WorldWind = window.WorldWind;

    layersRef.current.coordinates.enabled = showCoordinates;
    layersRef.current.controls.enabled = showControls;
    trueColorLayer.enabled = showTrueColor;
    aerosolLayer.enabled = showAerosol;
    aerosolLayer.opacity = rasterOpacity;
    satelliteLayer.enabled = showSatellites;

    satelliteLayer.removeAllRenderables();
    placemarksRef.current.clear();

    if (showSatellites) {
      for (const item of positionedFleet) {
        const position = new WorldWind.Position(item.latitude, item.longitude, item.altitudeKm * 1000);
        const placemark = new WorldWind.Placemark(position, false, null);
        const attributes = new WorldWind.PlacemarkAttributes(null);
        attributes.imageSource = `${WorldWind.configuration.baseUrl}images/pushpins/plain-red.png`;
        attributes.imageScale = item.norad === selectedNorad ? 0.9 : 0.68;
        attributes.labelAttributes.color = WorldWind.Color.WHITE;
        attributes.labelAttributes.font = "14px sans-serif";
        attributes.imageOffset = new WorldWind.Offset(
          WorldWind.OFFSET_FRACTION,
          0.3,
          WorldWind.OFFSET_FRACTION,
          0.0,
        );
        placemark.attributes = attributes;
        placemark.altitudeMode = WorldWind.RELATIVE_TO_GROUND;
        placemark.alwaysOnTop = true;
        placemark.label = item.englishName ?? item.name;
        placemark.userProperties = item;
        placemark.highlighted = item.norad === selectedNorad;
        satelliteLayer.addRenderable(placemark);
        placemarksRef.current.set(item.norad, placemark);
      }
    }

    if (selectedNorad) {
      const selected = positionedFleet.find((item) => item.norad === selectedNorad);
      if (selected) {
        wwd.goTo(new WorldWind.Position(selected.latitude, selected.longitude, selected.altitudeKm * 1000));
      }
    }

    wwd.redraw();
  }, [
    positionedFleet,
    rasterOpacity,
    selectedNorad,
    showControls,
    showCoordinates,
    showAerosol,
    showSatellites,
    showTrueColor,
  ]);

  return (
    <div className="worldwind-demo">
      <canvas id={canvasId} ref={hostRef} className="worldwind-demo__canvas" />
      {status !== "ready" ? (
        <div className="worldwind-demo__overlay">
          <strong>{status === "error" ? "WorldWind unavailable" : "Loading NASA WebWorldWind..."}</strong>
          <span>
            {status === "error"
              ? error
              : `NASA GIBS ${GIBS_ENDPOINT_MODE.toUpperCase()} true color, aerosol layers, and Korean placemarks are initializing.`}
          </span>
        </div>
      ) : null}
      <div className="worldwind-demo__legend">
        <span>{`NASA GIBS ${GIBS_ENDPOINT_MODE.toUpperCase()} · ${requestedDataDate} UTC`}</span>
        <strong>
          {normalizeDegrees(OVERLAY_BOUNDS.maxLatitude, "lat")} / {normalizeDegrees(OVERLAY_BOUNDS.minLongitude, "lon")}
        </strong>
      </div>
    </div>
  );
}
