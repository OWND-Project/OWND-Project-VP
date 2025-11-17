import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const initClient = async (databaseFilePath: string) => {
  const filepath = databaseFilePath;

  // https://github.com/kriasoft/node-sqlite
  const openDb = (() => {
    // https://github.com/TryGhost/node-sqlite3/wiki/Caching
    let _db: Database;
    return async () => {
      if (!_db) {
        // const filepath = databaseFilePath ?? process.env["DATABASE_FILEPATH"];
        if (typeof filepath === "undefined") {
          throw new Error("DATABASE_FILEPATH is not defined");
        }
        console.info("open database:", filepath);
        _db = await open({
          filename: filepath,
          driver: sqlite3.cached.Database,
        });
      }
      return _db;
    };
  })();
  const db = await openDb();

  const checkIfTableExists = async (table_name: string) => {
    try {
      // const db = await openDb();
      const result = await db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table_name}';`,
      );
      return result?.name === table_name;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const createDb = async (ddlMap: DDLMap) => {
    // const db = await openDb();
    for (const [key, value] of Object.entries(ddlMap)) {
      const b = await checkIfTableExists(key);
      if (!b) {
        console.debug(`create table ${key}@${filepath}`);
        await db.exec(value);
        console.debug("create table done");
      }
    }
  };

  const destroyDb = async (ddlMap: DDLMap) => {
    // const db = await openDb();
    // eslint-disable-next-line no-unused-vars
    for (const [key, _] of Object.entries(ddlMap)) {
      const b = await checkIfTableExists(key);
      if (b) {
        console.debug(`drop table ${key}@${filepath}`);
        await db.exec(`DROP TABLE ${key}`);
        console.debug("drop table done");
      }
    }
  };

  const init = async (databaseFilePath?: string) => {
    await createDb(DDL_MAP);
  };
  const destroy = async () => {
    await destroyDb(DDL_MAP);
  };
  await init();
  return { init, destroy, db };
};

type DDLMap = { [key: string]: string };

export const handleError = (err: any, db: Database) => {
  logger.error(JSON.stringify(db.config));
  console.error(err);
  if (err instanceof Error) {
    const { message } = err;
    if (message.includes("SQLITE_CONSTRAINT: UNIQUE constraint failed:")) {
      throw new Error("UNIQUE_CONSTRAINT_FAILED");
    }
  }
  throw err;
};

export const UNIQUE_CONSTRAINT_FAILED = "UNIQUE_CONSTRAINT_FAILED";
export const FOREIGN_KEY_CONSTRAINT_FAILED = "FOREIGN_KEY_CONSTRAINT_FAILED";

export const TBL_NM_URLS = "urls";
export const TBL_NM_CLAIMS = "claims";
export const TBL_NM_AFFILIATIONS = "affiliations";
export const TBL_NM_SYNC_HISTORIES = "sync_histories";

const DDL_URLS = `
  CREATE TABLE ${TBL_NM_URLS} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id VARCHAR(32) UNIQUE,
    url VARCHAR(4096) UNIQUE,
    search VARCHAR(4096),
    domain VARCHAR(255),
    title VARCHAR(255),
    description VARCHAR(2048),
    content_type VARCHAR(80),
    image VARCHAR(4096),
    source_created_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`.trim();

const DDL_CLAIMS = `
  CREATE TABLE ${TBL_NM_CLAIMS} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id VARCHAR(32) UNIQUE,
    comment VARCHAR(4096),
    bool_value INTEGER,
    url VARCHAR(4096),
    claimer_id VARCHAR(32),
    affiliation_id VARCHAR(32),
    source_created_at DATETIME,
    source_deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`.trim();

const DDL_AFFILIATIONS = `
  CREATE TABLE ${TBL_NM_AFFILIATIONS} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    affiliation_id VARCHAR(32) UNIQUE,
    claimer_id VARCHAR(32),
    claimer_sub VARCHAR(512),
    organization VARCHAR(32),
    source_created_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`.trim();

const DDL_SYNC_HISTORIES = `
  CREATE TABLE ${TBL_NM_SYNC_HISTORIES} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type VARCHAR(32),
    hash VARCHAR(255) UNIQUE,
    key VARCHAR(255) UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`.trim();

const DDL_MAP = {
  [TBL_NM_URLS]: DDL_URLS,
  [TBL_NM_CLAIMS]: DDL_CLAIMS,
  [TBL_NM_AFFILIATIONS]: DDL_AFFILIATIONS,
  [TBL_NM_SYNC_HISTORIES]: DDL_SYNC_HISTORIES,
};

export type SqlClient = Awaited<ReturnType<typeof initClient>>;

export default {
  handleError,
};
