import { reseedSatelliteCatalogFromCsv } from "../server/db.js";

const result = reseedSatelliteCatalogFromCsv();

console.log(
  JSON.stringify(
    {
      status: "ok",
      rowCount: result.rowCount,
      seedPath: result.seedPath,
      dbPath: result.dbPath,
    },
    null,
    2,
  ),
);
