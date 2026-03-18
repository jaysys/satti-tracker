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

export function fetchItems(params) {
  const query = new URLSearchParams();
  if (params.search) {
    query.set("search", params.search);
  }
  if (params.status && params.status !== "all") {
    query.set("status", params.status);
  }

  const search = query.toString();
  const url = search ? `/api/items?${search}` : "/api/items";
  return request(url);
}

export function createItem(payload) {
  return request("/api/items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateItem(id, payload) {
  return request(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteItem(id) {
  return request(`/api/items/${id}`, {
    method: "DELETE",
  });
}

export function fetchSatelliteFleet(mode = "snapshot") {
  const query = new URLSearchParams({ mode });
  return request(`/api/satellites?${query.toString()}`);
}

export function fetchLeoBackdrop(mode = "snapshot") {
  const query = new URLSearchParams({ mode });
  return request(`/api/satellites/leo-backdrop?${query.toString()}`);
}
