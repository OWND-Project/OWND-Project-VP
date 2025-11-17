import { decodeSdJwt } from "../../helpers/jwt-helper.js";
import * as jose from "jose";

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

// Boolcheck-specific functions removed (latestAffiliation, aggregateClaims, sortUrls)
