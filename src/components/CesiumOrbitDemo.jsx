import { Button, NonIdealState, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef, useState } from "react";
import { snapshotOrbitFleet } from "../../shared/satelliteCatalog.js";

export const orbitFleet = snapshotOrbitFleet;

const seoulHomeView = {
  longitude: 126.978,
  latitude: 37.5665,
  range: 1800000,
  heading: 0,
  pitch: -Math.PI / 2,
  roll: 0,
};

const initialGlobeView = {
  longitude: 126.978,
  latitude: 18,
  height: 22000000,
  heading: 0,
  pitch: -Math.PI / 2,
  roll: 0,
};

function formatDegrees(value, axis) {
  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}° ${suffix}`;
}

function formatAltitude(value) {
  return `${Math.round(value)} km`;
}

function computeState(satelliteLib, satrec, date) {
  const propagated = satelliteLib.propagate(satrec, date);
  if (!propagated?.position) {
    return null;
  }

  const gmst = satelliteLib.gstime(date);
  const geodetic = satelliteLib.eciToGeodetic(propagated.position, gmst);

  return {
    date,
    latitude: satelliteLib.degreesLat(geodetic.latitude),
    longitude: satelliteLib.degreesLong(geodetic.longitude),
    heightKm: geodetic.height,
  };
}

export default function CesiumOrbitDemo({
  fleet = orbitFleet,
  leoPoints = [],
  onTelemetryChange,
  onPointSelectionChange,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const cesiumRef = useRef(null);
  const satelliteRef = useRef(null);
  const pointCollectionRef = useRef(null);
  const koreanFleetRef = useRef([]);
  const clickHandlerRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    async function init() {
      try {
        if (!container) {
          return;
        }

        const Cesium = await import("cesium");
        const satellite = await import("satellite.js");
        cesiumRef.current = Cesium;
        satelliteRef.current = satellite;

        if (cancelled) {
          return;
        }

        container.innerHTML = "";

        const imageryProvider = await Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
        );
        const baseLayer = await Cesium.ImageryLayer.fromProviderAsync(imageryProvider);

        if (cancelled) {
          return;
        }

        const viewer = new Cesium.Viewer(container, {
          baseLayer,
          baseLayerPicker: false,
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          scene3DOnly: true,
        });

        viewer.scene.globe.enableLighting = false;
        viewer.scene.globe.showGroundAtmosphere = true;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#16324b");
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#030912");
        viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
        viewer.clock.multiplier = 30;
        viewer.clock.shouldAnimate = true;
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            initialGlobeView.longitude,
            initialGlobeView.latitude,
            initialGlobeView.height,
          ),
          orientation: {
            heading: initialGlobeView.heading,
            pitch: initialGlobeView.pitch,
            roll: initialGlobeView.roll,
          },
        });

        const now = new Date();
        const startTime = Cesium.JulianDate.fromDate(now);
        const stopTime = Cesium.JulianDate.addMinutes(startTime, 96, new Cesium.JulianDate());
        viewer.clock.startTime = startTime.clone();
        viewer.clock.stopTime = stopTime.clone();
        viewer.clock.currentTime = startTime.clone();

        pointCollectionRef.current = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());

        const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction((movement) => {
          const picked = viewer.scene.pick(movement.position);
          const payload = picked?.id?.kind === "leo-point" ? picked.id.payload : null;
          onPointSelectionChange?.(payload);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        clickHandlerRef.current = clickHandler;

        viewerRef.current = viewer;
        setStatus("ready");
      } catch (initError) {
        if (!cancelled) {
          setStatus("error");
          setError(initError.message);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      clickHandlerRef.current?.destroy();
      clickHandlerRef.current = null;
      koreanFleetRef.current = [];
      pointCollectionRef.current = null;

      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }

      viewerRef.current = null;
      cesiumRef.current = null;
      satelliteRef.current = null;

      if (container) {
        container.innerHTML = "";
      }
    };
  }, [onPointSelectionChange]);

  useEffect(() => {
    if (status !== "ready") {
      return undefined;
    }

    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const satellite = satelliteRef.current;
    if (!viewer || !Cesium || !satellite) {
      return undefined;
    }

    for (const record of koreanFleetRef.current) {
      if (record.entity) {
        viewer.entities.remove(record.entity);
      }
    }

    const now = new Date();
    const startTime = Cesium.JulianDate.fromDate(now);
    const nextFleet = fleet.map((item) => {
      const satrec = item.omm
        ? satellite.json2satrec(item.omm)
        : satellite.twoline2satrec(item.tle[0], item.tle[1]);

      const sampled = new Cesium.SampledPositionProperty();
      let sampleCount = 0;

      for (let minute = 0; minute <= 96; minute += 4) {
        const sampleTime = Cesium.JulianDate.addMinutes(startTime, minute, new Cesium.JulianDate());
        const state = computeState(satellite, satrec, Cesium.JulianDate.toDate(sampleTime));
        if (!state) {
          continue;
        }

        sampled.addSample(
          sampleTime,
          Cesium.Cartesian3.fromDegrees(
            state.longitude,
            state.latitude,
            state.heightKm * 1000,
          ),
        );
        sampleCount += 1;
      }

      if (sampleCount === 0) {
        return {
          ...item,
          satrec,
          entity: null,
          isAvailable: false,
        };
      }

      sampled.setInterpolationOptions({
        interpolationDegree: 2,
        interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
      });

      const entity = viewer.entities.add({
        name: item.name,
        position: sampled,
        point: {
          pixelSize: 9,
          color: Cesium.Color.fromCssColorString(item.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
        },
        label: {
          text: item.name,
          font: '12px "IBM Plex Sans", sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#07111d").withAlpha(0.72),
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
        path: {
          resolution: 120,
          leadTime: 5400,
          trailTime: 5400,
          width: item.name === "SpaceEye-T" ? 3 : 2,
          material: Cesium.Color.fromCssColorString(item.color).withAlpha(0.75),
        },
      });

      return {
        ...item,
        satrec,
        entity,
        isAvailable: true,
      };
    });

    koreanFleetRef.current = nextFleet;
    return undefined;
  }, [fleet, status]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    const Cesium = cesiumRef.current;
    const pointCollection = pointCollectionRef.current;
    if (!Cesium || !pointCollection) {
      return;
    }

    pointCollection.removeAll();

    for (const point of leoPoints) {
      pointCollection.add({
        id: {
          kind: "leo-point",
          payload: point,
        },
        position: Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitudeKm * 1000),
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString("#9bc6ff").withAlpha(0.82),
        outlineColor: Cesium.Color.fromCssColorString("#e8f3ff").withAlpha(0.28),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }, [leoPoints, status]);

  useEffect(() => {
    if (status !== "ready") {
      return undefined;
    }

    const Cesium = cesiumRef.current;
    const satellite = satelliteRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !satellite || !viewer) {
      return undefined;
    }

    function updateTelemetry() {
      const currentDate = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      const nextTelemetry = koreanFleetRef.current.map((item) => {
        const state = computeState(satellite, item.satrec, currentDate);
        if (!state) {
          return {
            name: item.name,
            domesticName: item.domesticName,
            latitude: null,
            longitude: item.sourceLabel,
            altitude: null,
            color: item.color,
            sourceDate: item.sourceDate,
            sourceLabel: "Ephemeris unavailable",
            sourceState: item.sourceState,
            orbitLabel: item.orbitLabel,
            missionLabel: item.missionLabel,
            operationalStatus: item.operationalStatus,
            orbitalSlot: item.orbitalSlot,
            norad: item.norad,
          };
        }

        return {
          name: item.name,
          domesticName: item.domesticName,
          latitude: formatDegrees(state.latitude, "lat"),
          longitude: formatDegrees(state.longitude, "lon"),
          altitude: formatAltitude(state.heightKm),
          color: item.color,
          sourceDate: item.sourceDate,
          sourceLabel: item.sourceLabel,
          sourceState: item.sourceState,
          orbitLabel: item.orbitLabel,
          missionLabel: item.missionLabel,
          operationalStatus: item.operationalStatus,
          orbitalSlot: item.orbitalSlot,
          norad: item.norad,
        };
      });

      onTelemetryChange?.(nextTelemetry);
    }

    updateTelemetry();
    const timer = window.setInterval(updateTelemetry, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [onTelemetryChange, status]);

  function handleZoomIn() {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.35);
  }

  function handleZoomOut() {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.45);
  }

  function handleFlyHome() {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) {
      return;
    }

    const target = Cesium.Cartesian3.fromDegrees(
      seoulHomeView.longitude,
      seoulHomeView.latitude,
      0,
    );

    viewer.trackedEntity = undefined;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 120000), {
      offset: new Cesium.HeadingPitchRange(
        seoulHomeView.heading,
        seoulHomeView.pitch,
        seoulHomeView.range,
      ),
      duration: 1.2,
    });
  }

  function handlePan(direction) {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    const moveAmount = viewer.camera.positionCartographic.height * 0.12;

    if (direction === "left") {
      viewer.camera.moveLeft(moveAmount);
      return;
    }

    if (direction === "right") {
      viewer.camera.moveRight(moveAmount);
      return;
    }

    if (direction === "up") {
      viewer.camera.moveUp(moveAmount);
      return;
    }

    viewer.camera.moveDown(moveAmount);
  }

  return (
    <div className="cesium-orbit-demo">
      <div ref={containerRef} className="cesium-orbit-demo__canvas" />

      {status === "ready" ? (
        <div className="cesium-orbit-demo__controls">
          <Button icon={IconNames.ARROW_LEFT} minimal onClick={() => handlePan("left")} />
          <Button icon={IconNames.ARROW_UP} minimal onClick={() => handlePan("up")} />
          <Button icon={IconNames.ARROW_DOWN} minimal onClick={() => handlePan("down")} />
          <Button icon={IconNames.ARROW_RIGHT} minimal onClick={() => handlePan("right")} />
          <Button icon={IconNames.ZOOM_IN} minimal onClick={handleZoomIn}>
            +
          </Button>
          <Button icon={IconNames.ZOOM_OUT} minimal onClick={handleZoomOut}>
            -
          </Button>
          <Button icon={IconNames.HOME} minimal onClick={handleFlyHome}>
            Home
          </Button>
        </div>
      ) : null}

      {status !== "ready" ? (
        <div className="cesium-orbit-demo__overlay">
          {status === "loading" ? (
            <div className="cesium-orbit-demo__state">
              <Spinner size={28} />
            </div>
          ) : (
            <NonIdealState
              icon="error"
              title="Cesium 초기화 실패"
              description={error || "렌더러 초기화 중 문제가 발생했다."}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
