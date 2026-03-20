import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createItem,
  deleteItem,
  getMetrics,
  getItemById,
  listItems,
  updateItem,
} from "./db.js";
import { getLeoBackdrop, getSatelliteCatalogSummary, getSatelliteFleet } from "./satellites.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 60041);
const host = process.env.HOST || "127.0.0.1";

app.use(express.json());

function validateItemPayload(body) {
  const allowedStatus = new Set(["planned", "active", "blocked", "done"]);
  const allowedPriority = new Set(["low", "medium", "high", "critical"]);

  const payload = {
    title: String(body.title ?? "").trim(),
    owner: String(body.owner ?? "").trim(),
    status: String(body.status ?? "").trim(),
    priority: String(body.priority ?? "").trim(),
    notes: String(body.notes ?? "").trim(),
  };

  if (!payload.title) {
    return { error: "제목은 필수입니다." };
  }

  if (!payload.owner) {
    return { error: "담당자는 필수입니다." };
  }

  if (!allowedStatus.has(payload.status)) {
    return { error: "유효하지 않은 상태값입니다." };
  }

  if (!allowedPriority.has(payload.priority)) {
    return { error: "유효하지 않은 우선순위입니다." };
  }

  return { payload };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/items", (req, res) => {
  const items = listItems({
    search: req.query.search,
    status: req.query.status,
  });
  res.json({ items, metrics: getMetrics() });
});

app.get("/api/satellites", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "snapshot";
  const payload = await getSatelliteFleet(mode);
  res.json(payload);
});

app.get("/api/satellites/leo-backdrop", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "snapshot";
  const payload = await getLeoBackdrop(mode);
  res.json(payload);
});

app.get("/api/satellites/catalog-summary", (_req, res) => {
  res.json(getSatelliteCatalogSummary());
});

app.post("/api/items", (req, res) => {
  const { error, payload } = validateItemPayload(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const item = createItem(payload);
  return res.status(201).json({ item, metrics: getMetrics() });
});

app.patch("/api/items/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "유효하지 않은 ID입니다." });
  }

  if (!getItemById(id)) {
    return res.status(404).json({ error: "항목을 찾을 수 없습니다." });
  }

  const { error, payload } = validateItemPayload(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const item = updateItem(id, payload);
  return res.json({ item, metrics: getMetrics() });
});

app.delete("/api/items/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "유효하지 않은 ID입니다." });
  }

  if (!getItemById(id)) {
    return res.status(404).json({ error: "항목을 찾을 수 없습니다." });
  }

  deleteItem(id);
  return res.status(204).end();
});

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`Pulse Desk server listening on http://${host}:${port}`);
});
