import { Docs } from "../orbit-db/index.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  UrlDocument,
} from "./types.js";
import { randomUniqueString } from "../utils/random-util.js";
import { getFQDN } from "../utils/url-util.js";
import { UrlMetadata } from "../services/ogp-service.js";

export type ClaimRepository = ReturnType<typeof initClaimRepository>;

export const initClaimRepository = (docs: Docs) => {
  let urlDocs = docs.documents["urls"];
  let claimerDocs = docs.documents["claimers"];
  let claimDocs = docs.documents["claims"];
  let affiliateDocs = docs.documents["affiliations"];

  const putUrl = async (payload: UrlMetadata & { url: string }) => {
    const { url, title, description, contentType, image, ogObject } = payload;
    const currentTime = new Date().toISOString();
    const __newUrl: UrlDocument = {
      id: randomUniqueString(),
      url: url.split("?")[0],
      domain: getFQDN(url) || "",
      title,
      content_type: contentType,
      description,
      search: new URL(url).search,
      image: JSON.stringify(image),
      created_at: currentTime,
    };
    await urlDocs.document.put<UrlDocument>(__newUrl);
    return __newUrl;
  };
  const getUrlAll = async () => {
    return await urlDocs.document.all<UrlDocument>();
  };

  const putClaimer = async (payload: {
    idToken: string;
    sub: string;
    icon: string;
  }) => {
    const { idToken, sub, icon } = payload;
    const currentTime = new Date().toISOString();
    const newClaimer = {
      id: randomUniqueString(),
      id_token: idToken,
      sub,
      icon,
      created_at: currentTime,
    };
    await claimerDocs.document.put<ClaimerDocument>(newClaimer);
    return newClaimer;
  };

  const putAffiliation = async (payload: {
    claimer_id: string;
    claimer_sub: string;
    organization: string;
  }) => {
    const { claimer_id, claimer_sub, organization } = payload;
    const currentTime = new Date().toISOString();
    const newAffiliation = {
      id: randomUniqueString(),
      claimer_id,
      claimer_sub,
      organization,
      created_at: currentTime,
    };
    await affiliateDocs.document.put<AffiliationDocument>(newAffiliation);
    return newAffiliation;
  };

  const getClaimByUrl = async (url: string) => {
    return await claimDocs.document.query<ClaimDocument>(
      (value) => value.url === url,
    );
  };

  const putClaim = async (
    payload: {
      comment: string;
      urlDoc: UrlDocument;
      claimerDoc: ClaimerDocument;
      affiliationDoc?: AffiliationDocument;
    },
    opts?: { currentTime?: Date },
  ) => {
    const currentTime =
      opts?.currentTime?.toISOString() ?? new Date().toISOString();
    const newClaim: ClaimDocument = {
      id: randomUniqueString(),
      url: payload.urlDoc.url,
      claimer_id: payload.claimerDoc.id,
      affiliation_id: payload.affiliationDoc?.id ?? "",
      comment: payload.comment,
      created_at: currentTime,
    };
    await claimDocs.document.put<ClaimDocument>(newClaim);
    return newClaim;
  };

  const deleteClaim = async <T>(claim: ClaimDocument) => {
    claim.deleted_at = new Date().toISOString();
    await claimDocs.document.put<ClaimDocument>(claim);
  };

  const getClaimById = async <T>(id: string) => {
    let claims = await claimDocs.document.query<ClaimDocument>(
      (value) => value.id === id && value.deleted_at === undefined,
    );
    if (claims.length === 0) {
      return null;
    }
    return claims[0];
  };

  const getClaimerById = async <T>(id: string) => {
    let claimers = await claimerDocs.document.query<ClaimerDocument>(
      (value) => value.id === id,
    );
    if (claimers.length === 0) {
      return null;
    }
    return claimers[0];
  };

  return {
    putClaim,
    getClaimerById,
    putClaimer,
    putAffiliation,
    getClaimByUrl,
    putUrl,
    getUrlAll,
    getClaimById,
    deleteClaim,
  };
};
