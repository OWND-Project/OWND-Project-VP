/**
 * SQLite Database Schema
 * OID4VP Verifier用のデータベーススキーマ定義
 */

/**
 * sessionsテーブル
 * OID4VPセッション管理
 */
export const DDL_SESSIONS = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  vp_token TEXT,
  credential_data TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  committed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_request_id ON sessions(request_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
`;

/**
 * requestsテーブル
 * OID4VP認証リクエスト管理
 */
export const DDL_REQUESTS = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  nonce TEXT,
  session TEXT,
  transaction_id TEXT,
  response_type TEXT,
  redirect_uri_returned_by_response_uri TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  encryption_private_jwk TEXT,
  dcql_query TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_expires_at ON requests(expires_at);
`;

/**
 * response_codesテーブル
 * レスポンスコード管理
 */
export const DDL_RESPONSE_CODES = `
CREATE TABLE IF NOT EXISTS response_codes (
  code TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  FOREIGN KEY (request_id) REFERENCES requests(id)
);

CREATE INDEX IF NOT EXISTS idx_response_codes_request_id ON response_codes(request_id);
CREATE INDEX IF NOT EXISTS idx_response_codes_expires_at ON response_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_response_codes_used ON response_codes(used);
`;

/**
 * presentation_definitionsテーブル
 * Deprecated: PEX removed in OID4VP 1.0, replaced by DCQL
 * This table will be dropped in a future migration
 */
// export const DDL_PRESENTATION_DEFINITIONS = `
// CREATE TABLE IF NOT EXISTS presentation_definitions (
//   id TEXT PRIMARY KEY,
//   definition TEXT NOT NULL,
//   created_at INTEGER NOT NULL
// );
// `;

/**
 * post_statesテーブル
 * 投稿状態管理
 */
export const DDL_POST_STATES = `
CREATE TABLE IF NOT EXISTS post_states (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  target_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_states_expires_at ON post_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_post_states_value ON post_states(value);
`;

/**
 * 全テーブルのDDL
 */
export const ALL_TABLES = [
  DDL_SESSIONS,
  DDL_REQUESTS,
  DDL_RESPONSE_CODES,
  // DDL_PRESENTATION_DEFINITIONS, // Removed: PEX deprecated
  DDL_POST_STATES,
];

/**
 * データベースの初期化
 */
export const initializeDatabase = async (db: any): Promise<void> => {
  for (const ddl of ALL_TABLES) {
    await db.exec(ddl);
  }
};
