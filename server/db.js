import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "pulse-desk.db");

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS work_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('planned', 'active', 'blocked', 'done')),
    priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const itemCount = db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count;

if (itemCount === 0) {
  const seed = db.prepare(`
    INSERT INTO work_items (title, owner, status, priority, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const seedRows = [
    [
      "신규 고객 온보딩 플로우 정리",
      "Jaeho",
      "active",
      "high",
      "가입부터 첫 액션까지 단계별 병목을 점검하고 있다.",
    ],
    [
      "운영 리포트 자동 발송 API",
      "Minji",
      "planned",
      "medium",
      "매주 월요일 오전 9시에 메일 발송되도록 설계할 예정이다.",
    ],
    [
      "결제 오류 재현 케이스 수집",
      "Alex",
      "blocked",
      "critical",
      "PG 로그와 사용자 세션 타임라인을 함께 수집해야 한다.",
    ],
    [
      "권한 분리용 관리자 화면 초안",
      "Sora",
      "done",
      "low",
      "기존 운영 화면과 접근 권한을 분리하는 작업을 마쳤다.",
    ],
  ];

  for (const row of seedRows) {
    seed.run(...row);
  }
}

export function listItems({ search = "", status = "all" } = {}) {
  const searchValue = `%${search.trim()}%`;
  const statusFilter = status === "all" ? "%" : status;

  return db
    .prepare(`
      SELECT *
      FROM work_items
      WHERE status LIKE ?
        AND (
          title LIKE ?
          OR owner LIKE ?
          OR notes LIKE ?
        )
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        datetime(updated_at) DESC
    `)
    .all(statusFilter, searchValue, searchValue, searchValue);
}

export function getMetrics() {
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM work_items
      GROUP BY status
    `)
    .all();

  const summary = {
    total: 0,
    planned: 0,
    active: 0,
    blocked: 0,
    done: 0,
  };

  for (const row of rows) {
    summary[row.status] = row.count;
    summary.total += row.count;
  }

  return summary;
}

export function createItem(input) {
  const stmt = db.prepare(`
    INSERT INTO work_items (title, owner, status, priority, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const result = stmt.run(
    input.title,
    input.owner,
    input.status,
    input.priority,
    input.notes ?? "",
  );

  return getItemById(result.lastInsertRowid);
}

export function updateItem(id, input) {
  const stmt = db.prepare(`
    UPDATE work_items
    SET
      title = ?,
      owner = ?,
      status = ?,
      priority = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(input.title, input.owner, input.status, input.priority, input.notes ?? "", id);
  return getItemById(id);
}

export function deleteItem(id) {
  return db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
}

export function getItemById(id) {
  return db.prepare("SELECT * FROM work_items WHERE id = ?").get(id);
}
