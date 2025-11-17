import { Database } from "sqlite";
import getLogger from "../services/logging-service.js";
import { Result, VoidResult } from "../tool-box/index.js";
import { decodeSdJwt } from "../helpers/jwt-helper.js";
import { randomUniqueString } from "../utils/random-util.js";
import {
  extractClaimerSub,
  extractCredentialSubject,
  extractOrgInfo,
} from "./internal/internal-helpers.js";
import {
  AffiliationDocument,
  BackupPresenter,
  ClaimDocument,
  ClaimerDocument,
  ClaimerPresenter,
  ClaimPresenter,
  ListOptions,
  NewClaimPresenter,
  UrlDocument,
  UrlMetadataPresenter,
  UrlPresenter,
} from "./types.js";
import { UrlHandler } from "./internal/select-url.js";
import {
  InvalidParameterResult,
  NotSuccessResult,
} from "../types/app-types.js";
import { Docs, OpenedDocument } from "../orbit-db/index.js";
import { initClaimRepository } from "./claim-repository.js";
import siopv2 from "../oid4vp/siop-v2.js";
import {
  affiliationHandler,
  claimHandler,
  LocalAffiliationHandler,
  LocalClaimHandler,
  LocalUrlHandler,
  urlHandler,
} from "../local-data/local-data-handler.js";

/**
 *
 * @param docs
 * @param db
 */
export const initClaimInteractor = (docs: Docs, db: Database) => {
  const logger = getLogger();

  let urlDocs = docs.documents["urls"];
  let claimerDocs = docs.documents["claimers"];
  let claimDocs = docs.documents["claims"];
  let affiliateDocs = docs.documents["affiliations"];
  let __urlHandler: LocalUrlHandler;
  let __claimHandler: LocalClaimHandler;
  let __affiliationHandler: LocalAffiliationHandler;

  const repository = initClaimRepository(docs);

  urlHandler(db).then((handler) => {
    __urlHandler = handler;
  });
  claimHandler(db).then((handler) => {
    __claimHandler = handler;
  });
  affiliationHandler(db).then((handler) => {
    __affiliationHandler = handler;
  });

  /**
   *
   * @param url
   * @param presenter
   */
  const putUrl = async <T>(
    url: string,
    presenter: UrlPresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info(`put url: ${url}`);
    const urlHandler = UrlHandler(docs, db);
    const selectedUrl = await urlHandler.selectUrl(url);
    if (!selectedUrl.ok) {
      return { ok: false, error: { type: selectedUrl.error.type } };
    }
    const { urlDoc } = selectedUrl.payload;
    if (urlDoc) {
      return {
        ok: false,
        error: {
          type: "CONFLICT",
          message: "URL already exists",
          instance: `/database/urls/${urlDoc.id}`,
        },
      };
    }
    const newUrl = await urlHandler.newUrl(url);
    if (!newUrl.ok) {
      const { type } = newUrl.error;
      if (type === "NotFound") {
        return { ok: false, error: { type: "NOT_FOUND" } };
      } else if (type === "ClientError") {
        return { ok: false, error: { type: "INVALID_PARAMETER" } };
      } else {
        return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
      }
    }

    return {
      ok: true,
      payload: presenter({
        ...newUrl.payload.urlDoc,
        oldest_created_at: newUrl.payload.urlDoc.created_at,
        true_count: 0,
        false_count: 0,
        else_count: 0,
        verified_true_count: 0,
        verified_false_count: 0,
        verified_else_count: 0,
      }),
    };
  };

  /**
   *
   * @param payload
   * @param presenter
   */
  const putClaim = async <T>(
    payload: any,
    presenter: NewClaimPresenter<T>,
  ): Promise<Result<T, InvalidParameterResult>> => {
    logger.info(`put claim: ${JSON.stringify(payload)}`);
    const { comment, id_token, affiliation } = payload;

    // extract url
    const credentialSubject = extractCredentialSubject(comment);
    if (!credentialSubject.decoded) {
      console.error("failed to decode jwt and extract url");
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }
    const { url } = credentialSubject.value;
    // console.log(url);

    const sub = extractClaimerSub(id_token);
    if (!sub.decoded) {
      console.error("failed to decode jwt and extract sub");
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }
    let orgInfo = { icon: "", affiliationExtKey: "" };
    if (affiliation) {
      const __orgInfo = extractOrgInfo(affiliation);
      if (!__orgInfo.decoded) {
        console.error("failed to decode jwt and extract sub");
        return { ok: false, error: { type: "INVALID_PARAMETER" } };
      }
      const { affiliationExtKey, icon } = __orgInfo.value;
      orgInfo = { icon, affiliationExtKey };
    }

    const currentTime = new Date().toISOString();

    // select url document
    const urlHandler = UrlHandler(docs, db);
    const selectedUrl = await urlHandler.selectAndRegisterUrl(url);
    if (!selectedUrl.ok) {
      const { type } = selectedUrl.error;
      // todo もう少し細かく制御したい
      return {
        ok: false,
        error: { type: "INVALID_PARAMETER", message: type },
      };
    }
    const { urlDoc } = selectedUrl.payload;

    // select claimer and affiliation document
    // const affHandler = await getAffiliationHandlerHandler();
    const selectedClaimer = await selectClaimer(
      claimerDocs,
      __affiliationHandler,
      id_token,
      sub.value,
      currentTime,
      orgInfo,
      affiliation,
    );
    const claimerDoc = selectedClaimer.claimer.doc;
    const affiliationDoc = selectedClaimer.affiliation.doc;
    if (selectedClaimer.claimer.isNew) {
      await claimerDocs.document.put<ClaimerDocument>(claimerDoc);
    }
    if (affiliationDoc && selectedClaimer.affiliation.isNew) {
      await affiliateDocs.document.put<AffiliationDocument>(affiliationDoc);
      // Dummy data to avoid the last HEAD being a large size data
      const dummyAff = {
        id: randomUniqueString(),
        claimer_id: "00000000-0000-0000-0000-000000000000",
        claimer_sub: "N/A",
        organization: "N/A",
        created_at: currentTime,
      };
      await affiliateDocs.document.put<AffiliationDocument>(dummyAff);
    }

    // register new claim
    const newClaim: ClaimDocument = {
      id: randomUniqueString(),
      url: urlDoc.url,
      claimer_id: claimerDoc.id,
      affiliation_id: affiliationDoc?.id ?? "",
      comment,
      created_at: currentTime,
    };
    await claimDocs.document.put<ClaimDocument>(newClaim);
    logger.info(`registered new claim: ${newClaim.id}`);

    return {
      ok: true,
      payload: presenter(newClaim),
    };
  };

  const deleteClaim = async <T>(
    id: string,
    idToken: string,
  ): Promise<VoidResult<NotSuccessResult>> => {
    logger.info(`delete a claim: ${id}`);
    if (!id || !idToken) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }
    try {
      const getIdToken = await siopv2.getIdToken(idToken);
      if (!getIdToken.ok) {
        return { ok: false, error: { type: "INVALID_PARAMETER" } };
      }

      const claim = await repository.getClaimById(id);
      if (!claim) {
        return { ok: false, error: { type: "NOT_FOUND" } };
      }
      const claimer = await repository.getClaimerById(claim.claimer_id);
      const { sub } = getIdToken.payload.idToken;
      if (claimer?.sub !== sub) {
        return { ok: false, error: { type: "INVALID_PARAMETER" } };
      }
      await repository.deleteClaim(claim);
      logger.info(`deleted a claim: ${id}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
    }
  };

  const getUrls = async <T>(opt: ListOptions, presenter: UrlPresenter<T>) => {
    const localClaims = await __claimHandler.getAggregatedUrl(opt);
    return localClaims.map((row) => {
      return presenter(row);
    });
  };

  const getUrl = async <T>(id: string, presenter: UrlPresenter<T>) => {
    const localUrl = await __urlHandler.getUrlByUrlId(id);
    if (!localUrl) {
      return null;
    }
    const localClaims = await __claimHandler.getAggregatedUrlByUrl(
      localUrl.url,
    );
    if (!localClaims) {
      return null;
    }
    return presenter(localClaims);
  };

  const getUrlMetadata = async <T>(
    id: string,
    presenter: UrlMetadataPresenter<T>,
  ) => {
    const localUrl = await __urlHandler.getUrlMetadata(id);
    if (!localUrl) {
      return null;
    }
    return presenter(localUrl);
  };

  const getClaimsByUrl = async <T>(
    id: string,
    presenter: ClaimPresenter<T>,
  ): Promise<Result<T[], UrlNotFound>> => {
    // get database object
    let claimerDocs = docs.documents["claimers"];
    let affiliateDocs = docs.documents["affiliations"];

    const localUrl = await __urlHandler.getUrlByUrlId(id);
    if (!localUrl) {
      return { ok: false, error: { type: "URL_NOT_FOUND" } };
    }

    // get urls data by id
    const aggregatedUrl = await __claimHandler.getAggregatedUrlByUrl(
      localUrl.url,
    );
    if (!aggregatedUrl) {
      return { ok: false, error: { type: "URL_NOT_FOUND" } };
    }
    // get claims data
    const localClaims = await __claimHandler.getClaimsByUrl(localUrl.url);

    // get claimers data
    const claimerIdsSet = new Set(localClaims.map((value) => value.claimer_id));
    let claimers = await claimerDocs.document.query<ClaimerDocument>((value) =>
      claimerIdsSet.has(value.id),
    );
    const claimerMap = new Map<string, ClaimerDocument>();
    claimers.forEach((claimer) => {
      claimerMap.set(claimer.id, claimer);
    });

    const payload = localClaims.map((claim) => {
      return presenter(
        { ...claim, id: claim.claim_id },
        aggregatedUrl,
        claimerMap.get(claim.claimer_id)!,
        claim.organization,
      );
    });
    return { ok: true, payload };
  };

  const getClaimsByClaimer = async <T>(
    id: string,
    presenter: ClaimPresenter<T>,
  ): Promise<Result<T[], ClaimNotFound>> => {
    // get database object
    let claimerDocs = docs.documents["claimers"];
    let affiliateDocs = docs.documents["affiliations"];

    // get claims data by id
    const localClaims = await __claimHandler.getClaimsByClaimer(id);
    if (localClaims.length === 0) {
      return { ok: false, error: { type: "CLAIM_NOT_FOUND" } };
    }

    // get claimers related with claims got
    const claimerIdsSet = new Set(localClaims.map((value) => value.claimer_id));
    let claimers = await claimerDocs.document.query<ClaimerDocument>(
      (claimer) => claimerIdsSet.has(claimer.id),
    );
    const claimersMap = new Map<string, ClaimerDocument>();
    claimers.forEach((claimer) => {
      claimersMap.set(claimer.id, claimer);
    });
    let affiliations = await __affiliationHandler.getAffiliationByClaimerId(id);
    let latestAffiliation = undefined;
    if (0 < affiliations.length) {
      latestAffiliation = affiliations[0];
    }

    const payload = [];
    for (const claim of localClaims) {
      // const url = urlsMap.get(claim.url_id)!;
      const localUrl = await __claimHandler.getAggregatedUrlByUrl(claim.url);
      const claimer = claimersMap.get(claim.claimer_id)!;
      payload.push(
        presenter(
          { ...claim, id: claim.claim_id },
          localUrl!,
          claimer,
          latestAffiliation?.organization,
        ),
      );
    }
    return { ok: true, payload };
  };

  const getClaim = async <T>(id: string, presenter: ClaimPresenter<T>) => {
    // get database object
    let claimDocs = docs.documents["claims"];
    let claimerDocs = docs.documents["claimers"];

    // get claims data
    let claims = await claimDocs.document.query<ClaimDocument>(
      (value) => value.id === id,
    );
    if (claims.length === 0) {
      return null;
    }

    const claim = claims[0];
    // get url data by url
    const localUrl = await __claimHandler.getAggregatedUrlByUrl(claim.url);

    // get claimer data by id
    let claimer = await claimerDocs.document.query<ClaimerDocument>(
      (value) => value.id === claim.claimer_id,
    );

    let affiliations = await __affiliationHandler.getAffiliationByClaimerId(
      claim.claimer_id,
    );
    let latestAffiliation = undefined;
    if (0 < affiliations.length) {
      latestAffiliation = affiliations[0];
    }

    return presenter(
      claim,
      localUrl!,
      claimer[0],
      latestAffiliation?.organization,
    );
  };

  const getClaimer = async <T>(id: string, presenter: ClaimerPresenter<T>) => {
    if (!__affiliationHandler) {
      __affiliationHandler = await affiliationHandler(db);
    }
    // get database object
    let claimerDocs = docs.documents["claimers"];

    // get claimers data
    let claimers = await claimerDocs.document.query<ClaimerDocument>(
      (value) => value.id === id,
    );
    if (claimers.length === 0) {
      return null;
    }

    let affiliations = await __affiliationHandler.getAffiliationByClaimerId(id);
    let latestAffiliation = undefined;
    if (0 < affiliations.length) {
      latestAffiliation = affiliations[0];
    }

    const claimer = claimers[0];
    return presenter(claimer, latestAffiliation?.organization);
  };

  const backupAll = async <T>(presenter: BackupPresenter<T>) => {
    let urlDocs = docs.documents["urls"];
    let claimerDocs = docs.documents["claimers"];
    let affiliateDocs = docs.documents["affiliations"];
    let claimDocs = docs.documents["claims"];

    const urls = await urlDocs.document.all<UrlDocument>();
    const claimers = await claimerDocs.document.all<ClaimerDocument>();
    const affiliations =
      await affiliateDocs.document.all<AffiliationDocument>();
    const claims = await claimDocs.document.all<ClaimDocument>();
    return presenter(
      urls.map((log) => log.value),
      claimers.map((log) => log.value),
      affiliations.map((log) => log.value),
      claims.map((log) => log.value),
    );
  };

  const restoreAll = async <T>(body: any) => {
    const { urls, claimers, affiliations, claims } = body;
    let urlDocs = docs.documents["urls"];
    let claimerDocs = docs.documents["claimers"];
    let affiliateDocs = docs.documents["affiliations"];
    let claimDocs = docs.documents["claims"];

    let cnt = 0;
    // ---------- urls -----------
    logger.info("restore urls");
    urls.forEach((data: UrlDocument) => {
      urlDocs.document.put(data);
      cnt++;
    });
    logger.info(`done(${cnt} count)`);
    const urlCount = cnt;

    // ---------- claimers -----------
    cnt = 0;
    logger.info("restore claimers");
    claimers.forEach((data: ClaimerDocument) => {
      claimerDocs.document.put(data);
      cnt++;
    });
    const claimerCount = cnt;

    // ---------- affiliations -----------
    cnt = 0;
    logger.info("restore affiliations");
    affiliations.forEach((data: AffiliationDocument) => {
      affiliateDocs.document.put(data);
      cnt++;
    });
    logger.info(`done(${cnt} count)`);
    const affiliationCount = cnt;

    // ---------- claims -----------
    cnt = 0;
    logger.info("restore claims");
    claims.forEach((data: ClaimDocument) => {
      claimDocs.document.put(data);
      cnt++;
    });
    logger.info(`done(${cnt} count)`);
    const claimCount = cnt;

    return { urlCount, claimerCount, affiliationCount, claimCount };
  };

  return {
    deleteClaim,
    putUrl,
    getUrls,
    getUrl,
    getUrlMetadata,
    getClaimsByUrl,
    getClaimsByClaimer,
    getClaim,
    getClaimer,
    putClaim,
    backupAll,
    restoreAll,
  };
};

export interface UrlNotFound {
  type: "URL_NOT_FOUND";
}

export interface ClaimNotFound {
  type: "CLAIM_NOT_FOUND";
}

const selectClaimer = async (
  claimerDocs: OpenedDocument,
  localAffiliatoinHandler: LocalAffiliationHandler,
  idToken: string,
  sub: string,
  currentTime: string,
  orgInfo: { affiliationExtKey: string; icon: string },
  affiliationJwt?: string,
) => {
  // find claimer by sub
  let claimers = await claimerDocs.document.query<ClaimerDocument>(
    (value) => value.sub === sub,
  );
  // decode affiliation vc
  // const orgInfo = affiliationJwt
  //   ? extractOrgInfo(affiliationJwt)
  //   : { icon: "", affiliationExtKey: "" };
  let newClm = claimers.length === 0;
  const claimerDoc = newClm
    ? {
        id: randomUniqueString(),
        id_token: idToken,
        sub: sub!,
        icon: orgInfo.icon,
        created_at: currentTime,
      }
    : claimers[0];
  let affiliations = await localAffiliatoinHandler.getAffiliationByClaimerId(
    claimerDoc.id,
  );
  const latestAffiliation =
    affiliations.length === 0
      ? undefined
      : {
          ...affiliations[0],
          id: affiliations[0].affiliation_id,
          created_at: affiliations[0].source_created_at,
        };
  if (!affiliationJwt) {
    return {
      claimer: { doc: claimerDoc, isNew: newClm },
      affiliation: { doc: latestAffiliation, isNew: false },
    };
  }
  // Save new VCs as up-to-date when they are shared
  const newAffiliation = {
    id: randomUniqueString(),
    claimer_id: claimerDoc.id,
    claimer_sub: sub,
    organization: affiliationJwt || "",
    created_at: currentTime,
  };
  return {
    claimer: { doc: claimerDoc, isNew: newClm },
    affiliation: { doc: newAffiliation, isNew: true },
  };
};

export default { initClaimInteractor };
