import { Docs } from "../orbit-db/index.js";
import { delay } from "../api.js";
import getLogger from "../services/logging-service.js";
import { DocType, Syncers } from "./syncer.js";

export const replication = (syncers: Syncers) => {
  const {
    syncUrl,
    syncClaim,
    syncAffiliation,
    latestHistory,
    saveLatestHistory,
  } = syncers;
  const logger = getLogger();
  let __docs: Docs;
  const setDocs = (docs: Docs) => {
    __docs = docs;
  };
  const checkDocs = async () => {
    let count = 0;
    while (__docs === undefined) {
      // console.warn("wait docs is activated..");
      logger.warn("wait docs is activated..");
      await delay(100);
      count += 1;
      if (count === 10) {
        throw new Error("Docs has not activated.");
      }
    }
  };
  const historyHandler = async (docType: DocType) => {
    const his = await latestHistory(docType);
    const latestHash = his?.hash;
    let lastSyncHash: string | undefined = undefined;
    let lastSyncKey: string | undefined = undefined;
    const setLatestHash = (hash: string, key: string) => {
      if (lastSyncHash === undefined) {
        // set only HEAD entry
        lastSyncHash = hash;
        lastSyncKey = key;
      }
    };
    const saveLatest = async () => {
      if (lastSyncHash !== undefined && lastSyncKey !== undefined) {
        saveLatestHistory(docType, lastSyncHash, lastSyncKey);
      }
    };
    return { latestHash, setLatestHash, saveLatest };
  };

  const syncAllUrls = async () => {
    logger.info("sync all urls");
    await checkDocs();

    const handler = await historyHandler("urls");
    let count = 0;
    let startTime = Date.now();
    for await (const { hash, key, value } of __docs.documents[
      "urls"
    ].document.iterator()) {
      if (hash === handler.latestHash) {
        logger.info(`${hash}} is already synced. finish syncing`);
        break;
      }
      await syncUrl(value, true);
      handler.setLatestHash(hash, key);
      count += 1;
      if (count % 1000 === 0) {
        logger.info(`${count} registered`);
      }
    }
    await handler.saveLatest();
    let endTime = Date.now();
    outTime(startTime, endTime, count);
  };

  const syncAllClaims = async () => {
    logger.info("sync all claims");
    await checkDocs();

    const handler = await historyHandler("claims");
    let count = 0;
    let startTime = Date.now();
    for await (const { hash, key, value } of __docs.documents[
      "claims"
    ].document.iterator()) {
      if (hash === handler.latestHash) {
        logger.info(`${hash}} is already synced. finish syncing`);
        break;
      }
      await syncClaim(value, true);
      handler.setLatestHash(hash, key);
      count += 1;
      if (count % 1000 === 0) {
        logger.info(`${count} registered`);
      }
    }
    await handler.saveLatest();
    let endTime = Date.now();
    outTime(startTime, endTime, count);
  };

  const syncAllAffiliations = async () => {
    logger.info("sync all affiliations");
    await checkDocs();

    const handler = await historyHandler("affiliations");
    let count = 0;
    let startTime = Date.now();
    for await (const { hash, key, value } of __docs.documents[
      "affiliations"
    ].document.iterator()) {
      if (hash === handler.latestHash) {
        logger.info(`${hash}} is already synced. finish syncing`);
        break;
      }
      await syncAffiliation(value, true);
      handler.setLatestHash(hash, key);
      count += 1;
      if (count % 1000 === 0) {
        logger.info(`${count} registered`);
      }
    }
    await handler.saveLatest();
    let endTime = Date.now();
    outTime(startTime, endTime, count);
  };

  const outTime = (startTime: number, endTime: number, count: number) => {
    const time = endTime - startTime;
    logger.info(`Execution Time(${count} count): ${time}ms`);
    // console.log(`Execution Time(${count} count):`, endTime - startTime, "ms");
  };
  return { setDocs, syncAllUrls, syncAllClaims, syncAllAffiliations };
};
