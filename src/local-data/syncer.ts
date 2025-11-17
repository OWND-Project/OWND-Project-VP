import { initClient } from "./sqlite-client.js";
import {
  affiliationHandler,
  claimHandler,
  LocalAffiliationHandler,
  LocalClaimHandler,
  LocalUrlHandler,
  syncHistoryHandler,
  SyncHistoryHandler,
  urlHandler,
} from "./local-data-handler.js";
import getLogger from "../services/logging-service.js";

export type Syncers = Awaited<ReturnType<typeof syncers>>;
export type DocType = "urls" | "claims" | "affiliations";

export const syncers = async (
  databaseFilePath: string,
  opts: {
    label: string;
  } = { label: "Main" },
) => {
  const { label } = opts;
  const sqliteClient = await initClient(databaseFilePath);
  const db = sqliteClient.db;
  let __urlHandler: LocalUrlHandler;
  let __claimHandler: LocalClaimHandler;
  let __affiliationHandler: LocalAffiliationHandler;
  let __syncHistoryHandler: SyncHistoryHandler;

  const logger = getLogger();

  const syncUrl = async (value: any, silent: boolean = false) => {
    if (!silent) {
      logger.debug(`add url@${label}: ${JSON.stringify(value)}`);
    }
    if (!__urlHandler) {
      __urlHandler = await urlHandler(db);
    }
    handleError(__urlHandler.addUrl(value));
  };
  const syncClaim = async (value: any, silent: boolean = false) => {
    if (!silent) {
      logger.debug(`add claim@${label}: ${JSON.stringify(value)}`);
    }
    if (!__claimHandler) {
      __claimHandler = await claimHandler(db);
    }
    if (value.deleted_at) {
      handleError(__claimHandler.deleteClaim(value));
    } else {
      handleError(__claimHandler.addClaim(value));
    }
  };

  const syncAffiliation = async (value: any, silent: boolean = false) => {
    if (!silent) {
      logger.debug(`add affiliation@${label}: ${JSON.stringify(value)}`);
    }
    if (!__affiliationHandler) {
      __affiliationHandler = await affiliationHandler(db);
    }
    handleError(__affiliationHandler.addAffiliation(value));
  };

  function handleError(promise: Promise<any>): void {
    promise.catch((err) => {
      if (err instanceof Error) {
        logger.error(err.message || "no message");
        if (err.stack) {
          logger.error(err.stack);
        }
      } else if (typeof err === "object" && err !== null && "message" in err) {
        logger.error((err as { message: string }).message);
      } else {
        logger.error(err);
      }
    });
  }

  const latestHistory = async (docType: DocType) => {
    if (!__syncHistoryHandler) {
      __syncHistoryHandler = await syncHistoryHandler(db);
    }
    return await __syncHistoryHandler.getLatestSyncHistory(docType);
  };

  const saveLatestHistory = async (
    docType: DocType,
    hash: string,
    key: string,
  ) => {
    if (!__syncHistoryHandler) {
      __syncHistoryHandler = await syncHistoryHandler(db);
    }
    await __syncHistoryHandler.addSyncHistory(docType, hash, key);
  };

  return {
    syncUrl,
    syncClaim,
    syncAffiliation,
    latestHistory,
    saveLatestHistory,
  };
};
