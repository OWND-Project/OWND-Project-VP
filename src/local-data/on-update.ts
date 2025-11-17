import getLogger from "../services/logging-service.js";
import { delay } from "../api.js";

type SyncEntry = (value: any, silent?: boolean) => Promise<void>;
type SyncAll = () => Promise<void>;
export const onUpdate = async (
  opts: {
    label: string;
    syncUrl?: SyncEntry;
    syncClaim?: SyncEntry;
    syncAffiliation?: SyncEntry;
    syncAllUrls?: SyncAll;
    syncAllClaims?: SyncAll;
    syncAllAffiliations?: SyncAll;
  } = { label: "Main" },
) => {
  const {
    label,
    syncUrl,
    syncClaim,
    syncAffiliation,
    syncAllUrls,
    syncAllAffiliations,
    syncAllClaims,
  } = opts;

  const logger = getLogger();

  const log = (docName: string, entry: any) => {
    const { bytes, ...rest } = entry;
    logger.info(
      `on update@${docName}@${label}: ${JSON.stringify({ ...rest })}`,
    );
  };

  let onUrlUpdateCalled = false;
  let onClaimUpdateCalled = false;
  let onAffiliationUpdateCalled = false;

  const resetState = () => {
    logger.debug("reset on update state");
    onUrlUpdateCalled = false;
    onClaimUpdateCalled = false;
    onAffiliationUpdateCalled = false;
  };

  const onUpdateUrls = async (entry: any) => {
    log("urls", entry);
    const { value } = entry.payload;
    if (!onUrlUpdateCalled && syncAllUrls) {
      onUrlUpdateCalled = true;
      syncAllUrls().then(() => {
        logger.info("sync urls done");
      });
    } else {
      if (syncUrl) {
        syncUrl(value).then(() => logger.info("sync a url done"));
      }
    }
  };

  const onUpdateClaims = async (entry: any) => {
    log("claims", entry);
    const { value } = entry.payload;
    if (!onClaimUpdateCalled && syncAllClaims) {
      onClaimUpdateCalled = true;
      syncAllClaims().then(() => logger.info("sync claims done"));
    } else {
      if (syncClaim) {
        syncClaim(value).then(() => logger.info("sync a claim done"));
      }
    }
  };

  const onUpdateAffiliations = async (entry: any) => {
    log("affiliations", entry);
    const { value } = entry.payload;
    if (!onAffiliationUpdateCalled && syncAllAffiliations) {
      onAffiliationUpdateCalled = true;
      syncAllAffiliations().then(() => logger.info("sync affiliations done"));
    } else {
      if (syncAffiliation) {
        syncAffiliation(value).then(() =>
          logger.info("sync a affiliation done"),
        );
      }
    }
  };

  return {
    onUpdateUrls,
    onUpdateClaims,
    onUpdateAffiliations,
    resetState,
  };
};
