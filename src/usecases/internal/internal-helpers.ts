import { decodeSdJwt } from "../../helpers/jwt-helper.js";
import * as jose from "jose";

import {
  AffiliationDocument,
  ClaimDocument,
  SortOptions,
  UrlDocument,
} from "../types.js";

export interface DecodeOk<T = string> {
  decoded: true;
  value: T;
}
export interface DecodeNg {
  decoded: false;
}
export type DecodeResult<T = string> = DecodeOk<T> | DecodeNg;

export const extractOrgInfo = (
  affiliationJwt: string,
): DecodeResult<{ affiliationExtKey: string; icon: string }> => {
  const { issueJwt, disclosures } = decodeSdJwt(affiliationJwt);
  // console.log(issueJwt, disclosures);
  const { iss, iat } = issueJwt;
  if (!iss || !iat) {
    return { decoded: false };
  }
  const affiliationExtKey = iss + iat;
  let icon = "";
  disclosures.forEach((disclosure) => {
    if (disclosure.key === "portrait") {
      icon = disclosure.value;
    }
  });
  return { decoded: true, value: { affiliationExtKey, icon } };
};

export const extractClaimerSub = (idToken: string): DecodeResult => {
  try {
    const decoded = jose.decodeJwt(idToken);
    const { sub } = decoded;
    if (!sub) {
      return { decoded: false };
    }
    return { decoded: true, value: sub };
  } catch (e) {
    console.error(e);
    return { decoded: false };
  }
};

export const extractCredentialSubject = (jwtVc: string): DecodeResult<any> => {
  try {
    let decoded = jose.decodeJwt(jwtVc);
    const { vc } = decoded;
    if (!vc) {
      return { decoded: false };
    }
    const { credentialSubject } = vc as any;
    if (!credentialSubject) {
      return { decoded: false };
    }
    return { decoded: true, value: credentialSubject };
  } catch (e) {
    console.error(e);
    return { decoded: false };
  }
};

export const latestAffiliation = (affiliations: AffiliationDocument[]) => {
  affiliations.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return affiliations.length === 0 ? undefined : affiliations[0];
};

export const aggregateClaims = (claims: ClaimDocument[]) => {
  return claims
    .map((claims) => {
      const decoded = jose.decodeJwt(claims.comment);
      const { vc } = decoded;
      const { credentialSubject } = vc as any;
      const { bool_value } = credentialSubject as any;
      return {
        true_count: bool_value === 1 ? 1 : 0,
        false_count: bool_value === 0 ? 1 : 0,
        else_count: bool_value === 2 ? 1 : 0,
      };
    })
    .reduce(
      (acc, current) => {
        return {
          true_count: acc.true_count + current.true_count,
          false_count: acc.false_count + current.false_count,
          else_count: acc.else_count + current.else_count,
        };
      },
      { true_count: 0, false_count: 0, else_count: 0 },
    );
};

const sortKeys = ["true_count", "false_count", "created_at"];
export const sortUrls = (
  allUrls: UrlDocument[],
  claims: ClaimDocument[],
  opt: SortOptions,
) => {
  const { sortKey, desc } = opt;

  allUrls.sort((a, b) => {
    if (sortKeys.includes(sortKey || "")) {
      const orderDet = desc ? -1 : 1;
      if (sortKey === "true_count" || sortKey === "false_count") {
        const claimsThisUrlA = claims.filter((claims) => claims.url === a.url);
        const claimsThisUrlB = claims.filter((claims) => claims.url === b.url);
        const countsA = aggregateClaims(claimsThisUrlA);
        const countsB = aggregateClaims(claimsThisUrlB);
        let primSort;
        if (sortKey === "true_count") {
          primSort = (countsA.true_count - countsB.true_count) * orderDet;
        } else {
          primSort = (countsA.false_count - countsB.false_count) * orderDet;
        }
        return primSort === 0
          ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          : primSort;
      } else {
        return (
          (new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()) *
          orderDet
        );
      }
    } else {
      // sort created_at desc as default sort
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
  });
};
