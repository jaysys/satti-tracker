import { Button, NonIdealState, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef, useState } from "react";
import { computeState, getOrbitSamplingConfig, supportsEarthGlobeTrack } from "../lib/orbitMath";

const seoulHomeView = {
  longitude: 126.978,
  latitude: 37.5665,
  range: 4500000,
  heading: 0,
  pitch: -Math.PI / 2,
  roll: 0,
};

const initialGlobeView = {
  longitude: 126.978,
  latitude: 18,
  height: 16500000,
  heading: 0,
  pitch: -Math.PI / 2,
  roll: 0,
};

const CLOCK_WINDOW_MINUTES = 180;

function formatDegrees(value, axis) {
  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}° ${suffix}`;
}

function formatAltitude(value) {
  return `${Math.round(value)} km`;
}

function isPositionInCameraView(Cesium, scene, occluder, position) {
  if (!position) {
    return false;
  }

  if (!occluder.isPointVisible(position)) {
    return false;
  }

  const cameraToPoint = Cesium.Cartesian3.subtract(position, scene.camera.positionWC, new Cesium.Cartesian3());
  return Cesium.Cartesian3.dot(cameraToPoint, scene.camera.directionWC) > 0;
}

export default function CesiumOrbitDemo({
  fleet = [],
  leoPoints = [],
  onSatelliteSelectionChange,
  onTelemetryChange,
  onPointSelectionChange,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const cesiumRef = useRef(null);
  const satelliteRef = useRef(null);
  const pointCollectionRef = useRef(null);
  const pointRecordsRef = useRef([]);
  const koreanFleetRef = useRef([]);
  const clickHandlerRef = useRef(null);
  const preRenderCallbackRef = useRef(null);
  const pointSelectionCallbackRef = useRef(onPointSelectionChange);
  const satelliteSelectionCallbackRef = useRef(onSatelliteSelectionChange);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    pointSelectionCallbackRef.current = onPointSelectionChange;
  }, [onPointSelectionChange]);

  useEffect(() => {
    satelliteSelectionCallbackRef.current = onSatelliteSelectionChange;
  }, [onSatelliteSelectionChange]);

  function updateVisibleObjects() {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) {
      return;
    }

    const scene = viewer.scene;
    const occluder = new Cesium.EllipsoidalOccluder(scene.globe.ellipsoid, scene.camera.positionWC);
    const currentTime = viewer.clock.currentTime;

    for (const item of koreanFleetRef.current) {
      if (!item.entity?.position) {
        continue;
      }

      const position = item.entity.position.getValue(currentTime);
      item.entity.show = isPositionInCameraView(Cesium, scene, occluder, position);
    }

    for (const record of pointRecordsRef.current) {
      record.primitive.show = isPositionInCameraView(Cesium, scene, occluder, record.position);
    }
  }

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
        const stopTime = Cesium.JulianDate.addMinutes(startTime, CLOCK_WINDOW_MINUTES, new Cesium.JulianDate());
        viewer.clock.startTime = startTime.clone();
        viewer.clock.stopTime = stopTime.clone();
        viewer.clock.currentTime = startTime.clone();

        pointCollectionRef.current = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());

        const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction((movement) => {
          const picked = viewer.scene.pick(movement.position);
          const pointPayload = picked?.id?.kind === "leo-point" ? picked.id.payload : null;
          const satellitePayload = picked?.id?.kind === "korean-satellite" ? picked.id.payload : null;
          pointSelectionCallbackRef.current?.(pointPayload);
          satelliteSelectionCallbackRef.current?.(satellitePayload);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        clickHandlerRef.current = clickHandler;

        const handlePreRender = () => {
          updateVisibleObjects();
        };
        viewer.scene.preRender.addEventListener(handlePreRender);
        preRenderCallbackRef.current = handlePreRender;

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
      if (viewerRef.current && preRenderCallbackRef.current) {
        viewerRef.current.scene.preRender.removeEventListener(preRenderCallbackRef.current);
      }
      preRenderCallbackRef.current = null;
      koreanFleetRef.current = [];
      pointRecordsRef.current = [];
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
  }, []);

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
      if (!supportsEarthGlobeTrack(item) || (!item.omm && !item.tle)) {
        return {
          ...item,
          satrec: null,
          entity: null,
          isAvailable: false,
        };
      }

      const satrec = item.omm
        ? satellite.json2satrec(item.omm)
        : satellite.twoline2satrec(item.tle[0], item.tle[1]);
      const { halfWindowMinutes, sampleStepMinutes } = getOrbitSamplingConfig(item);

      const sampled = new Cesium.SampledPositionProperty();
      let sampleCount = 0;

      const sampleStartMinute = -halfWindowMinutes;
      const sampleStopMinute = CLOCK_WINDOW_MINUTES + halfWindowMinutes;

      for (let minute = sampleStartMinute; minute <= sampleStopMinute; minute += sampleStepMinutes) {
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
        name: item.englishName ?? item.name,
        position: sampled,
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString(item.color),
          outlineColor: Cesium.Color.fromCssColorString("#f5fbff"),
          outlineWidth: 2,
        },
        label: {
          text: item.englishName ?? item.name,
          font: '13px "IBM Plex Sans", sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString("#f5fbff"),
          outlineColor: Cesium.Color.fromCssColorString("#04111d"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#04111d").withAlpha(0.84),
          pixelOffset: new Cesium.Cartesian2(0, -20),
        },
        path: {
          resolution: 120,
          leadTime: halfWindowMinutes * 60,
          trailTime: halfWindowMinutes * 60,
          width: item.name === "SpaceEye-T" ? 1.2 : 0.8,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(item.color).withAlpha(0.92),
            gapColor: Cesium.Color.fromCssColorString("#ffffff").withAlpha(0.08),
            dashLength: 14,
          }),
        },
      });
      entity.kind = "korean-satellite";
      entity.payload = {
        norad: item.norad,
      };

      return {
        ...item,
        satrec,
        entity,
        isAvailable: true,
      };
    });

    koreanFleetRef.current = nextFleet;
    updateVisibleObjects();
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
    pointRecordsRef.current = [];

    for (const point of leoPoints) {
      const position = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitudeKm * 1000);
      const primitive = pointCollection.add({
        id: {
          kind: "leo-point",
          payload: point,
        },
        position,
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString("#9bc6ff").withAlpha(0.82),
        outlineColor: Cesium.Color.fromCssColorString("#e8f3ff").withAlpha(0.28),
        outlineWidth: 1,
      });
      pointRecordsRef.current.push({ primitive, position });
    }

    updateVisibleObjects();
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
        if (!item.satrec) {
          return {
            name: item.englishName ?? item.name,
            domesticName: item.domesticName,
            latitude: null,
            longitude: supportsEarthGlobeTrack(item) ? item.sourceLabel : "Earth-globe track unsupported",
            altitude: null,
            color: item.color,
            sourceDate: item.sourceDate,
            sourceLabel: supportsEarthGlobeTrack(item) ? "Ephemeris unavailable" : "Earth-globe track unsupported",
            sourceState: item.sourceState,
            orbitLabel: item.orbitLabel,
            orbitalSlot: item.orbitalSlot,
            norad: item.norad,
          };
        }

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
            orbitalSlot: item.orbitalSlot,
            norad: item.norad,
          };
        }

        return {
          name: item.englishName ?? item.name,
          domesticName: item.domesticName,
          latitude: formatDegrees(state.latitude, "lat"),
          longitude: formatDegrees(state.longitude, "lon"),
          altitude: formatAltitude(state.heightKm),
          color: item.color,
          sourceDate: item.sourceDate,
          sourceLabel: item.sourceLabel,
          sourceState: item.sourceState,
          orbitLabel: item.orbitLabel,
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
