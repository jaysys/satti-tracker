export function computeState(satelliteLib, satrec, date) {
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getOrbitPeriodMinutes(item) {
  const periodFromOmm = Number(item?.omm?.PERIOD);
  if (Number.isFinite(periodFromOmm) && periodFromOmm > 0) {
    return periodFromOmm;
  }

  const meanMotion = Number(item?.omm?.MEAN_MOTION);
  if (Number.isFinite(meanMotion) && meanMotion > 0) {
    return 1440 / meanMotion;
  }

  return item?.orbitClass === "geo" ? 1436 : 96;
}

export function getOrbitSamplingConfig(item) {
  const periodMinutes = clamp(getOrbitPeriodMinutes(item), 90, 1436);
  const halfWindowMinutes = periodMinutes / 2;
  const sampleStepMinutes = clamp(periodMinutes / 90, 2, 20);

  return {
    periodMinutes,
    halfWindowMinutes,
    sampleStepMinutes,
  };
}

export function supportsEarthGlobeTrack(item) {
  return item.orbitClass !== "cislunar";
}
