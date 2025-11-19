import { importJWK, JWTHeaderParameters, SignJWT } from "jose";
import { PrivateJwk } from "elliptic-jwk";

import { generateRandomString } from "../utils/random-util.js";
import { ClientMetadata, DcqlQuery } from "./types.js";
import { parseClientId } from "./client-id-utils.js";

export interface GenerateRequestObjectOptions {
  iss?: string;
  aud?: string;
  nonce?: string;
  state?: string;
  scope?: any;
  responseType?: string;
  responseMode?: "direct_post" | "direct_post.jwt" | "query" | "fragment";
  redirectUri?: string;
  responseUri?: string;
  clientMetadata?: ClientMetadata;
  clientMetadataUri?: string;
  dcqlQuery?: DcqlQuery;
  presentationDefinition?: any; // Deprecated: Use dcqlQuery instead
  presentationDefinitionUri?: string; // Deprecated: Use dcqlQuery instead
  x509CertificateInfo?: X509CertificateInfo;
}
export interface RequestObject extends GenerateRequestObjectOptions {
  clientId: string;
}

export class UnsupportedClientIdSchemeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedClientIdSchemeError";
  }
}

export class MissingUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingUriError";
  }
}

export class MissingSignerKey extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingSignerKeyError";
  }
}

export const generateRequestObjectPayload = (
  clientId: string,
  options: GenerateRequestObjectOptions = {},
): RequestObject => {
  /*
    So that the request is a valid OAuth 2.0 Authorization Request,
    values for the response_type and client_id parameters MUST be included using the OAuth 2.0 request syntax,
    since they are REQUIRED by OAuth 2.0.

    The values for these parameters MUST match those in the Request Object, if present.

    https://www.rfc-editor.org/rfc/rfc9101.html#name-authorization-request
    https://openid.net/specs/openid-connect-core-1_0.html#RequestObject
  */

  if (!options.redirectUri && !options.responseUri) {
    throw new MissingUriError(
      "Either redirectUri or responseUri must be provided.",
    );
  }
  if (options.redirectUri && options.responseUri) {
    throw new MissingUriError(
      "Both redirectUri and responseUri cannot be provided simultaneously.",
    );
  }

  // Validate that clientId has a valid prefix (OID4VP 1.0)
  const parsed = parseClientId(clientId);
  if (!parsed) {
    throw new UnsupportedClientIdSchemeError(
      `Client ID must include a valid prefix (redirect_uri:, x509_san_dns:, or x509_hash:). Got: ${clientId}`,
    );
  }

  // Warn if redirect_uri prefix is used with signed requests
  if (parsed.prefix === "redirect_uri" && options.x509CertificateInfo) {
    console.warn(
      "[Warning] redirect_uri prefix cannot be used with signed requests. Signature will be ignored by Wallet.",
    );
  }

  const payload: RequestObject = {
    clientId: clientId, // Must include prefix
    nonce: options.nonce || generateRandomString(),
    state: options.state || generateRandomString(),
    responseType: options.responseType || "vp_token",
    responseMode: options.responseMode || "fragment",
  };

  if (options.scope) {
    payload.scope = options.scope;
  }

  if (options.responseUri) {
    payload.responseUri = options.responseUri;
  } else if (options.redirectUri) {
    payload.redirectUri = options.redirectUri;
  }

  if (options.clientMetadata) {
    payload.clientMetadata = options.clientMetadata;
  }

  if (options.dcqlQuery) {
    payload.dcqlQuery = options.dcqlQuery;
  }

  // Deprecated: PEX support (will be removed in future versions)
  if (options.presentationDefinition) {
    payload.presentationDefinition = options.presentationDefinition;
  }
  if (options.presentationDefinitionUri) {
    payload.presentationDefinitionUri = options.presentationDefinitionUri;
  }

  return payload;
};

export const generateRequestObjectJwt = async (
  clientId: string,
  issuerJwk: PrivateJwk,
  options: GenerateRequestObjectOptions = {},
): Promise<string> => {
  const alg = getKeyAlgorithm(issuerJwk);
  const basicHeader: JWTHeaderParameters = { alg: alg, typ: "JWT" };
  const info = selectX509CertificateInfo(options.x509CertificateInfo || {});

  const header = info ? { ...basicHeader, ...info } : basicHeader;
  const { kty, crv, x, y, d } = issuerJwk;
  const key = await importJWK({ kty, crv, x, y, d }, alg);

  const payload = generateRequestObjectPayload(clientId, options);
  payload.iss = options.iss || clientId;
  payload.aud = options.aud || "https://self-issued.me/v2";
  return await new SignJWT(camelToSnake(payload))
    .setProtectedHeader(header)
    .sign(key);
};

export function generateClientMetadata(
  clientId: string,
  opts?: ClientMetadata,
): ClientMetadata {
  // OID4VP_CLIENT_METADATA_NAME
  const clientMetadata: ClientMetadata = {
    clientId,
    vpFormats: {
      jwt_vp: {
        alg: ["ES256"],
      },
    },
  };
  if (opts?.clientName) {
    clientMetadata.clientName = opts.clientName;
  }
  if (opts?.logoUri) {
    clientMetadata.logoUri = opts.logoUri;
  }
  if (opts?.policyUri) {
    clientMetadata.policyUri = opts.policyUri;
  }
  if (opts?.tosUri) {
    clientMetadata.tosUri = opts.tosUri;
  }
  return clientMetadata;
}

export const getKeyAlgorithm = (jwk: PrivateJwk): string => {
  switch (jwk.kty) {
    case "EC":
      // todo add patterns of crv
      if (jwk.crv === "P-256") {
        return "ES256";
      } else {
        return "ES256K";
      }
    case "OKP":
      return "EdDSA";
    default:
      throw new Error("Unsupported key type");
  }
};

export interface X509CertificateInfo {
  x5u?: string;
  x5c?: string[];
}

export const selectX509CertificateInfo = (
  info: X509CertificateInfo,
): { [key: string]: any } | undefined => {
  if (info.x5u != undefined && info.x5u != "") {
    return { x5u: info.x5u };
  }
  if (info.x5c != undefined && info.x5c.length > 0) {
    return { x5c: info.x5c };
  }
  return undefined;
};

const toSnakeCase = (key: string): string =>
  key.replace(/([A-Z])/g, "_$1").toLowerCase();

export const camelToSnake = (obj: any): Record<string, any> => {
  // オブジェクトの場合の処理
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newKey = toSnakeCase(key);
        newObj[newKey] = camelToSnake(obj[key]); // 再帰的に処理
      }
    }
    return newObj;
  }

  // 配列の場合の処理
  if (Array.isArray(obj)) {
    return obj.map((item) => camelToSnake(item)); // 配列の各要素に対して再帰的に処理
  }

  // オブジェクトや配列でない場合、そのまま返す
  return obj;
};
// export const camelToSnake = (obj: {
//   [key: string]: any;
// }): {
//   [key: string]: any;
// } => {
//   const newObj: { [key: string]: any } = {};
//   for (const key in obj) {
//     if (Object.prototype.hasOwnProperty.call(obj, key)) {
//       const newKey = toSnakeCase(key);
//       newObj[newKey] = obj[key];
//     }
//   }
//   return newObj;
// };

const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (match, p1) => p1.toUpperCase());
};

export const snakeToCamel = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map((v) => snakeToCamel(v));
  } else if (obj !== null && typeof obj === "object") {
    return Object.keys(obj).reduce(
      (result, key) => {
        result[toCamelCase(key)] = snakeToCamel(obj[key]);
        return result;
      },
      {} as { [key: string]: any },
    );
  }
  return obj;
};
