/**
 * SQLite Client
 * OID4VP Verifier用のSQLiteクライアント
 */

import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { initializeDatabase } from "./schema.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export interface SQLiteClient {
  db: Database;
  init: () => Promise<void>;
  destroy: () => Promise<void>;
}

/**
 * SQLiteクライアントの初期化
 * @param databaseFilePath データベースファイルパス
 * @returns SQLiteClient
 */
export const initClient = async (
  databaseFilePath: string
): Promise<SQLiteClient> => {
  logger.info(`Opening SQLite database: ${databaseFilePath}`);

  // データベースを開く
  const db = await open({
    filename: databaseFilePath,
    driver: sqlite3.cached.Database,
  });

  // WALモードを有効化(同時アクセス性能向上)
  await db.exec("PRAGMA journal_mode=WAL");
  await db.exec("PRAGMA busy_timeout=5000");

  const init = async () => {
    logger.info("Initializing database schema");
    await initializeDatabase(db);
    logger.info("Database schema initialized");
  };

  const destroy = async () => {
    logger.info("Closing database connection");
    await db.close();
  };

  // 初期化を実行
  await init();

  return { db, init, destroy };
};

/**
 * 期限切れデータのクリーンアップ
 * @param db Database
 */
export const cleanupExpiredData = async (db: Database): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);

  // 期限切れのセッションを削除
  await db.run("DELETE FROM sessions WHERE expires_at < ?", [now]);

  // 期限切れのリクエストを削除
  await db.run("DELETE FROM requests WHERE expires_at < ?", [now]);

  // 期限切れのレスポンスコードを削除
  await db.run("DELETE FROM response_codes WHERE expires_at < ?", [now]);

  // 期限切れの投稿状態を削除
  await db.run("DELETE FROM post_states WHERE expires_at < ?", [now]);

  logger.debug("Cleaned up expired data");
};

/**
 * 定期的なクリーンアップタスクを開始
 * @param db Database
 * @param intervalMs クリーンアップ間隔(ミリ秒)
 * @returns クリーンアップを停止する関数
 */
export const startPeriodicCleanup = (
  db: Database,
  intervalMs: number = 3600000 // デフォルト1時間
): (() => void) => {
  const intervalId = setInterval(async () => {
    try {
      await cleanupExpiredData(db);
    } catch (error) {
      logger.error("Failed to cleanup expired data", { error });
    }
  }, intervalMs);

  return () => {
    clearInterval(intervalId);
    logger.info("Stopped periodic cleanup");
  };
};
