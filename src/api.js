async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "요청 처리 중 오류가 발생했습니다.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function fetchSatelliteFleet(mode = "snapshot") {
  const query = new URLSearchParams({ mode });
  return request(`/api/satellites?${query.toString()}`);
}

export function fetchLeoBackdrop(mode = "snapshot") {
  const query = new URLSearchParams({ mode });
  return request(`/api/satellites/leo-backdrop?${query.toString()}`);
}

export function fetchSatelliteCatalogSummary() {
  return request("/api/satellites/catalog-summary");
}

export function fetchAirkoreaDashboard() {
  return request("/api/airkorea/dashboard");
}
