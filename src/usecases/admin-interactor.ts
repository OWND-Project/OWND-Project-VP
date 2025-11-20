import { Database } from "sqlite";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export interface DatabaseStats {
  requests: number;
  postStates: number;
  sessions: number;
  responseCodes: number;
}

export interface RequestRecord {
  id: string;
  nonce: string | null;
  transaction_id: string | null;
  response_type: string;
  redirect_uri_returned_by_response_uri: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  encryption_private_jwk: string | null;
  dcql_query: string | null;
  dcql_query_parsed?: any; // Parsed DCQL query for display
}

export interface PostStateRecord {
  id: string;
  value: string;
  target_id: string | null;
  created_at: number;
  expires_at: number;
}

export interface SessionRecord {
  id: string;
  request_id: string;
  state: string;
  vp_token: string | null;
  credential_data: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  committed_at: number | null;
}

export interface ResponseCodeRecord {
  code: string;
  request_id: string;
  payload: string | null;
  created_at: number;
  expires_at: number;
  used: number;
}

export class AdminInteractor {
  constructor(private db: Database) {}

  /**
   * Get database statistics
   */
  async getStats(): Promise<DatabaseStats> {
    try {
      const requestsCount = await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM requests"
      );

      const postStatesCount = await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM post_states"
      );

      const sessionsCount = await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM sessions"
      );

      const responseCodesCount = await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM response_codes"
      );

      return {
        requests: requestsCount?.count || 0,
        postStates: postStatesCount?.count || 0,
        sessions: sessionsCount?.count || 0,
        responseCodes: responseCodesCount?.count || 0,
      };
    } catch (error) {
      logger.error(`Failed to get database stats: ${error}`);
      throw error;
    }
  }

  /**
   * Get all requests
   */
  async getAllRequests(): Promise<RequestRecord[]> {
    try {
      const requests = await this.db.all<RequestRecord[]>(
        `SELECT id, nonce, transaction_id, response_type,
                redirect_uri_returned_by_response_uri, created_at, expires_at,
                consumed_at, encryption_private_jwk, dcql_query
         FROM requests
         ORDER BY created_at DESC`
      );

      // Parse DCQL query for display
      const parsedRequests = (requests || []).map(req => {
        if (req.dcql_query) {
          try {
            req.dcql_query_parsed = JSON.parse(req.dcql_query);
          } catch (e) {
            logger.warn(`Failed to parse DCQL query for request ${req.id}: ${e}`);
            req.dcql_query_parsed = null;
          }
        }
        return req;
      });

      return parsedRequests;
    } catch (error) {
      logger.error(`Failed to get requests: ${error}`);
      throw error;
    }
  }

  /**
   * Get all post states
   */
  async getAllPostStates(): Promise<PostStateRecord[]> {
    try {
      const states = await this.db.all<PostStateRecord[]>(
        `SELECT id, value, target_id, created_at, expires_at
         FROM post_states
         ORDER BY created_at DESC`
      );

      return states || [];
    } catch (error) {
      logger.error(`Failed to get post states: ${error}`);
      throw error;
    }
  }

  /**
   * Get all sessions
   */
  async getAllSessions(): Promise<SessionRecord[]> {
    try {
      const sessions = await this.db.all<SessionRecord[]>(
        `SELECT id, request_id, state, vp_token, credential_data, created_at, expires_at, consumed_at, committed_at
         FROM sessions
         ORDER BY created_at DESC`
      );

      return sessions || [];
    } catch (error) {
      logger.error(`Failed to get sessions: ${error}`);
      throw error;
    }
  }

  /**
   * Get all response codes
   */
  async getAllResponseCodes(): Promise<ResponseCodeRecord[]> {
    try {
      const codes = await this.db.all<ResponseCodeRecord[]>(
        `SELECT code, request_id, payload, created_at, expires_at, used
         FROM response_codes
         ORDER BY created_at DESC`
      );

      return codes || [];
    } catch (error) {
      logger.error(`Failed to get response codes: ${error}`);
      throw error;
    }
  }

  /**
   * Delete expired records from all tables
   */
  async deleteExpiredRecords(): Promise<{
    requests: number;
    postStates: number;
    sessions: number;
    responseCodes: number;
  }> {
    try {
      const now = Math.floor(Date.now() / 1000);

      const requestsDeleted = await this.db.run(
        "DELETE FROM requests WHERE expires_at < ?",
        [now]
      );

      const postStatesDeleted = await this.db.run(
        "DELETE FROM post_states WHERE expires_at < ?",
        [now]
      );

      const sessionsDeleted = await this.db.run(
        "DELETE FROM sessions WHERE expires_at < ?",
        [now]
      );

      const responseCodesDeleted = await this.db.run(
        "DELETE FROM response_codes WHERE expires_at < ?",
        [now]
      );

      logger.info(
        `Deleted expired records: requests=${requestsDeleted.changes}, ` +
          `postStates=${postStatesDeleted.changes}, ` +
          `sessions=${sessionsDeleted.changes}, ` +
          `responseCodes=${responseCodesDeleted.changes}`
      );

      return {
        requests: requestsDeleted.changes || 0,
        postStates: postStatesDeleted.changes || 0,
        sessions: sessionsDeleted.changes || 0,
        responseCodes: responseCodesDeleted.changes || 0,
      };
    } catch (error) {
      logger.error(`Failed to delete expired records: ${error}`);
      throw error;
    }
  }

  /**
   * Clear all data from all tables
   */
  async clearAllData(): Promise<{
    requests: number;
    postStates: number;
    sessions: number;
    responseCodes: number;
  }> {
    try {
      const requestsDeleted = await this.db.run("DELETE FROM requests");
      const postStatesDeleted = await this.db.run("DELETE FROM post_states");
      const sessionsDeleted = await this.db.run("DELETE FROM sessions");
      const responseCodesDeleted = await this.db.run("DELETE FROM response_codes");

      logger.warn(
        `Cleared all data: requests=${requestsDeleted.changes}, ` +
          `postStates=${postStatesDeleted.changes}, ` +
          `sessions=${sessionsDeleted.changes}, ` +
          `responseCodes=${responseCodesDeleted.changes}`
      );

      return {
        requests: requestsDeleted.changes || 0,
        postStates: postStatesDeleted.changes || 0,
        sessions: sessionsDeleted.changes || 0,
        responseCodes: responseCodesDeleted.changes || 0,
      };
    } catch (error) {
      logger.error(`Failed to clear all data: ${error}`);
      throw error;
    }
  }
}

export const initAdminInteractor = (db: Database): AdminInteractor => {
  return new AdminInteractor(db);
};
