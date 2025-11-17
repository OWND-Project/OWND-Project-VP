import { Database } from "sqlite";

import {
  handleError,
  TBL_NM_AFFILIATIONS,
  TBL_NM_CLAIMS,
  TBL_NM_SYNC_HISTORIES,
  TBL_NM_URLS,
} from "./sqlite-client.js";
import {
  AffiliationDocument,
  AggregateResult,
  ClaimDocument,
  ListOptions,
  UrlDocument,
} from "../usecases/types.js";
import { decodeJwt } from "jose";
import { VerifiableCredential } from "../oid4vp/index.js";
import getLogger from "../services/logging-service.js";

interface BaseTable {
  id: string;
  created_at: string;
  updated_at: string;
}

interface UrlTable extends BaseTable {
  url_id: string;
  url: string;
  search: string;
  domain: string;
  title: string;
  description: string;
  content_type: string;
  image: string;
  source_created_at: string;
}

interface ClaimTable extends BaseTable {
  claim_id: string;
  comment: string;
  bool_value: number;
  url: string;
  claimer_id: string;
  affiliation_id: string;
  organization: string;
  source_created_at: string;
}

interface AffiliationTable extends BaseTable {
  affiliation_id: string;
  claimer_id: string;
  claimer_sub: string;
  organization: string;
  source_created_at: string;
}

interface SyncHistoryTable extends BaseTable {
  doc_type: string;
  hash: string;
  key: string;
}

export type AggregatedUrl = UrlDocument &
  AggregateResult & { oldest_created_at: string };

let traceEventRegistered = false;

const registerTraceEvent = (
  db: Database,
  logger: ReturnType<typeof getLogger>,
) => {
  if (!traceEventRegistered) {
    traceEventRegistered = true;
    db.on("trace", (sql: string) => {
      // console.info(sql);
      logger.info(sql.replaceAll("\n", " ").replaceAll(/ {2,}/g, " "));
    });
  }
};

export const urlHandler = async (db: Database) => {
  const logger = getLogger();
  registerTraceEvent(db, logger);

  const insertColumns = [
    "url_id", // 1
    "url", // 2
    "search", // 3
    "domain", // 4
    "title", // 5
    "description", // 6
    "content_type", // 7
    "image", // 8
    "source_created_at", // 9
  ];
  const queryColumns = ["id", ...insertColumns, "created_at", "updated_at"];

  const addUrl = async (urlDoc: UrlDocument) => {
    logger.debug(`insert url: ${JSON.stringify(urlDoc)}`);
    const {
      id,
      url,
      title,
      description,
      domain,
      search,
      content_type,
      image,
      created_at,
    } = urlDoc;
    try {
      const columns = insertColumns.join(", ");
      const placeholders = Array.from(insertColumns, (_) => "?").join(", ");
      const sql = `INSERT INTO ${TBL_NM_URLS} (${columns}) VALUES (${placeholders})`;
      const result = await db.run(
        sql,
        id,
        url,
        search,
        domain,
        title,
        description,
        content_type,
        image,
        created_at,
      );
      return result.lastID!;
    } catch (err) {
      logger.warn(JSON.stringify(urlDoc));
      handleError(err, db);
    }
  };

  const getUrlByUrlId = async (urlId: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_URLS} WHERE url_id = ?`;
      const result = await db.get<UrlTable>(sql, urlId);
      if (result) {
        return result;
      } else {
        return undefined;
      }
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };
  const getUrlByUrl = async (url: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_URLS} WHERE url = ?`;
      return await db.get<UrlTable>(sql, url);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };
  const getUrlsByUrl = async (url: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_URLS} WHERE url LIKE ?`;
      return await db.all<UrlTable[]>(sql, `%${url}%`);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };
  const getUrlMetadata = async (id: string) => {
    const cols = queryColumns.filter((col) => col !== "id");
    cols.push("url_id as id");
    try {
      const sql = `SELECT ${cols.join(", ")} FROM ${TBL_NM_URLS} WHERE url_id = ?`;
      return await db.get<UrlTable>(sql, id);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  return {
    addUrl,
    getUrlByUrlId,
    getUrlByUrl,
    getUrlsByUrl,
    getUrlMetadata,
  };
};

export const claimHandler = async (db: Database) => {
  const logger = getLogger();
  registerTraceEvent(db, logger);

  const insertColumns = [
    "claim_id",
    "comment",
    "bool_value",
    "url",
    "claimer_id",
    "affiliation_id",
    "source_created_at",
    "source_deleted_at",
  ];
  const queryColumns = [
    "id",
    ...insertColumns,
    "created_at",
    "updated_at",
  ].join(", ");
  const addClaim = async (claimDoc: ClaimDocument) => {
    logger.debug(`insert claim: ${JSON.stringify(claimDoc)}`);

    const {
      id,
      comment,
      url,
      claimer_id,
      affiliation_id,
      created_at,
      deleted_at,
    } = claimDoc;
    const decoded = decodeJwt<
      VerifiableCredential<{
        url: string;
        bool_value: number;
        comment: string;
      }>
    >(comment);
    try {
      const columns = insertColumns.join(", ");
      const placeholders = Array.from(insertColumns, (_) => "?").join(", ");
      const sql = `INSERT INTO ${TBL_NM_CLAIMS} (${columns}) VALUES (${placeholders})`;
      const result = await db.run(
        sql,
        id,
        comment,
        decoded.vc.credentialSubject.bool_value,
        url,
        claimer_id,
        affiliation_id,
        created_at,
        deleted_at,
      );
      return result.lastID!;
    } catch (err) {
      handleError(err, db);
    }
  };

  const deleteClaim = async (claimDoc: ClaimDocument) => {
    logger.debug(`delete a claim: ${JSON.stringify(claimDoc)}`);
    const { id } = claimDoc;
    try {
      const sql = `DELETE FROM ${TBL_NM_CLAIMS} WHERE claim_id = ?`;
      const result = await db.run(sql, id);
      return result.lastID!;
    } catch (err) {
      handleError(err, db);
    }
  };

  const getClaimById = async (claimId: string) => {
    try {
      const sql = `SELECT ${queryColumns} FROM ${TBL_NM_CLAIMS} WHERE claim_id = ? `;
      return await db.get<ClaimTable>(sql, claimId);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  const getClaimsByClaimer = async (claimerId: string) => {
    try {
      const sql = `SELECT ${queryColumns} FROM ${TBL_NM_CLAIMS} WHERE claimer_id = ? ORDER BY source_created_at DESC, id`;
      return await db.all<ClaimTable[]>(sql, claimerId);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  const getClaimsByUrl = async (url: string) => {
    const filteredCols = insertColumns.filter(
      (col) =>
        col !== "id" &&
        col !== "claimer_id" &&
        col !== "affiliation_id" &&
        col !== "source_created_at",
    );
    const queryColumns = [
      "a.id",
      ...filteredCols,
      "a.claimer_id",
      "a.affiliation_id",
      "b.organization",
      "a.source_created_at",
      "a.created_at",
      "a.updated_at",
    ].join(", ");
    try {
      const sql = `
        SELECT
          ${queryColumns}
        FROM
          ${TBL_NM_CLAIMS} a
        LEFT JOIN ${TBL_NM_AFFILIATIONS} b ON a.affiliation_id = b.affiliation_id
        WHERE url = ? ORDER BY a.source_created_at DESC, a.id`;
      return await db.all<
        (ClaimTable & { organization: string | undefined })[]
      >(sql, url);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  const groupSql = `
      SELECT
        MIN(b.url_id) as id,
        a.url,
        MAX(domain) AS domain,
        MAX(title) AS title,
        MAX(description) AS description,
        MAX(search) AS search,
        MAX(content_type) AS content_type,
        MAX(image) AS image,
        SUM(CASE WHEN bool_value = 1 THEN 1 ELSE 0 END) AS true_count,
        SUM(CASE WHEN bool_value = 0 THEN 1 ELSE 0 END) AS false_count,
        SUM(CASE WHEN bool_value = 2 THEN 1 ELSE 0 END) AS else_count,
        SUM(CASE WHEN bool_value = 1 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_true_count,
        SUM(CASE WHEN bool_value = 0 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_false_count,
        SUM(CASE WHEN bool_value = 2 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_else_count,
        MIN(a.source_created_at) AS oldest_created_at
      FROM
        claims a
      INNER JOIN urls b ON a.url = b.url
    `;
  // MAX(source_created_at) AS created_at,
  //     MIN(source_created_at) AS oldest_created_at
  const getAggregatedUrl = async (opt: ListOptions = {}) => {
    const { filter, startDate, sortKey, desc } = opt;
    const f = async () => {
      if (filter || startDate || sortKey) {
        const where = [];
        const params: any[] = [];
        let having = "";
        let orderBy = "";
        if (filter) {
          where.push(" a.url LIKE ?");
          params.push(`%${filter}%`);
        }
        if (startDate) {
          logger.debug(`startDate: ${startDate.toISOString()}`);
          having = "HAVING oldest_created_at >= ?";
          params.push(startDate.toISOString());
        } else if (!filter) {
          having = "HAVING oldest_created_at IS NOT NULL";
        }
        if (sortKey) {
          let __sortKey: string = sortKey;
          if (sortKey === "created_at") {
            __sortKey = "oldest_created_at";
          } else if (sortKey === "true_count") {
            __sortKey = "verified_true_count";
          } else if (sortKey === "false_count") {
            __sortKey = "verified_false_count";
          }
          orderBy = `${__sortKey} ${desc ? `DESC` : ""}`;
        } else {
          orderBy = "oldest_created_at DESC";
        }
        const sql = `
          ${groupSql}
          ${0 < where.length ? " WHERE " + where.join(" AND ") : " "}
          GROUP BY
            a.url
          ${having}
          ORDER BY
            ${orderBy}
          `;
        return await db.all<AggregatedUrl[]>(sql, ...params);
      } else {
        const sql = `
          ${groupSql}
            GROUP BY
              a.url
            HAVING oldest_created_at IS NOT NULL
            ORDER BY
              oldest_created_at DESC
          `;
        return await db.all<AggregatedUrl[]>(sql);
      }
    };
    try {
      return await f();
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  const getAggregatedUrlByUrl = async (url: string) => {
    const sql = `
    ${groupSql}
     WHERE 
        b.url = ?
     GROUP BY
        a.url
    `;
    try {
      const result = await db.get<AggregatedUrl>(sql, url);
      if (result) {
        return result;
      } else {
        return undefined;
      }
    } catch (err) {
      handleError(err, db);
    }
  };

  //   const getAggregatedUrlByClaimer = async (id: string) => {
  //     const sql = `
  //       SELECT
  //         url_id as id,
  //         url,
  //         GROUP_CONCAT(claimer_id, '|') AS claimer_ids,
  //         SUM(CASE WHEN bool_value = 1 THEN 1 ELSE 0 END) AS true_count,
  //         SUM(CASE WHEN bool_value = 0 THEN 1 ELSE 0 END) AS false_count,
  //         SUM(CASE WHEN bool_value = 2 THEN 1 ELSE 0 END) AS else_count,
  //         MAX(source_created_at) AS created_at
  //       FROM
  //         claims
  //       GROUP BY
  //         url
  //       HAVING
  //         claimer_ids LIKE '%' || ? || '%'
  //       ORDER BY
  //         created_at DESC;
  // `;
  //     try {
  //       const result = await db.all<AggregatedUrl[]>(sql, id);
  //       if (result) {
  //         return result;
  //       } else {
  //         return undefined;
  //       }
  //     } catch (err) {
  //       handleError(err);
  //     }
  //   };

  return {
    addClaim,
    deleteClaim,
    getClaimById,
    getClaimsByClaimer,
    getClaimsByUrl,
    getAggregatedUrl,
    getAggregatedUrlByUrl,
  };
};

export const affiliationHandler = async (db: Database) => {
  const logger = getLogger();
  registerTraceEvent(db, logger);

  const insertColumns = [
    "affiliation_id", // 1
    "claimer_id", // 2
    "claimer_sub", // 3
    "organization", // 4
    "source_created_at", // 5
  ];
  const queryColumns = ["id", ...insertColumns, "created_at", "updated_at"];

  const addAffiliation = async (affiliationDoc: AffiliationDocument) => {
    logger.debug(`insert affiliation: ${JSON.stringify(affiliationDoc)}`);
    const { id, claimer_id, claimer_sub, organization, created_at } =
      affiliationDoc;
    try {
      const columns = insertColumns.join(", ");
      const placeholders = Array.from(insertColumns, (_) => "?").join(", ");
      const sql = `INSERT INTO ${TBL_NM_AFFILIATIONS} (${columns}) VALUES (${placeholders})`;
      const result = await db.run(
        sql,
        id,
        claimer_id,
        claimer_sub,
        organization,
        created_at,
      );
      return result.lastID!;
    } catch (err) {
      handleError(err, db);
    }
  };

  const getAffiliationById = async (affiliationId: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_AFFILIATIONS} WHERE affiliation_id = ?`;
      const result = await db.get<AffiliationTable>(sql, affiliationId);
      if (result) {
        return result;
      } else {
        return undefined;
      }
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  const getAffiliationByClaimerId = async (claimerId: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_AFFILIATIONS} WHERE claimer_id = ? ORDER BY source_created_at DESC`;
      return await db.all<AffiliationTable[]>(sql, claimerId);
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  return {
    addAffiliation,
    getAffiliationById,
    getAffiliationByClaimerId,
  };
};

export const syncHistoryHandler = async (db: Database) => {
  const logger = getLogger();
  registerTraceEvent(db, logger);

  const insertColumns = [
    "doc_type", // 1
    "hash", // 2
    "key", // 3
  ];
  const queryColumns = ["id", ...insertColumns, "created_at", "updated_at"];

  const addSyncHistory = async (docType: string, hash: string, key: string) => {
    logger.debug(`insert sync_histories: ${docType}, ${hash}`);
    try {
      const columns = insertColumns.join(", ");
      const placeholders = Array.from(insertColumns, (_) => "?").join(", ");
      const sql = `INSERT INTO ${TBL_NM_SYNC_HISTORIES} (${columns}) VALUES (${placeholders})`;
      const result = await db.run(sql, docType, hash, key);
      return result.lastID!;
    } catch (err) {
      handleError(err, db);
    }
  };

  const getLatestSyncHistory = async (docType: string) => {
    try {
      const sql = `SELECT ${queryColumns.join(", ")} FROM ${TBL_NM_SYNC_HISTORIES} WHERE doc_type = ? ORDER BY created_at DESC`;
      const result = await db.all<SyncHistoryTable[]>(sql, docType);
      if (result && result.length > 0) {
        return result[0];
      } else {
        return undefined;
      }
    } catch (error) {
      handleError(error, db);
      throw error;
    }
  };

  return {
    addSyncHistory,
    getLatestSyncHistory,
  };
};

export type LocalUrlHandler = Awaited<ReturnType<typeof urlHandler>>;
export type LocalClaimHandler = Awaited<ReturnType<typeof claimHandler>>;
export type LocalAffiliationHandler = Awaited<
  ReturnType<typeof affiliationHandler>
>;
export type SyncHistoryHandler = Awaited<ReturnType<typeof syncHistoryHandler>>;
