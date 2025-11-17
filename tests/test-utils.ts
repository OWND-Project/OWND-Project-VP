import fs from "fs/promises";
import path from "path";
import * as jose from "jose";
import { v4 as uuidv4 } from "uuid";
import ellipticJwk, {
  CRV,
  PrivateJwk,
  PublicJwk,
  publicJwkFromPrivate,
} from "elliptic-jwk";
import { faker } from "@faker-js/faker";

import { getFQDN } from "../src/utils/url-util.js";
import { issueJwt, issueSdJwt } from "../src/helpers/jwt-helper.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  ImageDocument,
  UrlDocument,
} from "../src/usecases/types.js";
import { toJwkThumbprintUri } from "../src/oid4vp/jwk-util.js";
import {
  CERT_PEM_POSTAMBLE,
  CERT_PEM_PREAMBLE,
} from "../src/tool-box/x509/constant.js";

export const generateTemporaryPath = (...paths: string[]) => {
  const randomPath = uuidv4();
  return path.join("tests", "tmp", randomPath, ...paths);
};

export const clearDir = async (baseDir: string = "tmp") => {
  const tmpPath = path.join("tests", baseDir);
  try {
    await fs.rm(tmpPath, { recursive: true, force: true });
    console.log(`Directory ${tmpPath} deleted.`);
  } catch (err) {
    console.error(`Failed to delete directory: ${err}`);
  }
};

export const getDirectorySize = async (
  directoryPath: string,
): Promise<number> => {
  let totalSize = 0;

  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);

      if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      } else if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      }
    }
  } catch (err) {
    console.error(`Failed to calculate size for ${directoryPath}:`, err);
  }

  return totalSize;
};

interface CommentVC {
  url: string;
  comment: string;
  boolValue: number;
}
export const createClaimPayload = (opt: Partial<CommentVC> = {}) => {
  return {
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "CommentCredential"],
      credentialSubject: {
        url: opt.url ?? faker.internet.url(),
        comment: opt.comment ?? faker.string.alpha(10),
        bool_value: opt.boolValue ?? faker.number.int({ min: 0, max: 2 }),
      },
    },
  };
};

export const createKeyPair = (crv: CRV = "P-256") => {
  return ellipticJwk.newPrivateJwk("P-256");
};

interface PublicKeySettingJwk {
  type: "jwk";
}
// todo support multi types
// interface PublicKeySettingX5C {
//   type: "x5c"
// }
// interface PublicKeySettingJwks {
//   type: "jwks"
//   path: "./wellKnown/jwks.json"
// }
type PublicKeySetting = PublicKeySettingJwk;
export const createSdJwt = async (
  claims: any,
  disclosures: string[],
  opt?: {
    issuerPrivateJwk?: PrivateJwk;
    holderPublicJwk?: PublicJwk;
    publicKeySetting?: PublicKeySetting;
    iss?: string;
    iat?: number;
    exp?: number;
  },
) => {
  const issueKeyPair = opt?.issuerPrivateJwk ?? createKeyPair();
  const holderKeyPair = opt?.holderPublicJwk ?? createKeyPair();

  const header: jose.JWTHeaderParameters = {
    alg: "ES256",
    kid: "issuer-key-id",
  };
  if (opt?.publicKeySetting?.type === "jwk") {
    header.jwk = issueKeyPair;
    // todo x5c support
  } else {
    // default
    header.jwk = issueKeyPair;
  }
  const payload = {
    iss: opt?.iss ?? faker.internet.url(),
    iat: opt?.iat,
    exp: opt?.exp,
    ...claims,
  };
  const disclosureFrame = {
    _sd: disclosures,
  };
  return await issueSdJwt(
    header,
    payload,
    disclosureFrame,
    issueKeyPair,
    holderKeyPair,
  );
};

export const createIdToken = async (opt?: {
  privateJwk?: PrivateJwk;
  nonce?: string;
  iat?: number;
  exp?: number;
}) => {
  const privateJwk = opt?.privateJwk ?? createKeyPair();
  const jwk = publicJwkFromPrivate(privateJwk);
  const sub = await toJwkThumbprintUri(jwk);
  const idTokenPayload = {
    iss: sub,
    aud: faker.string.uuid(),
    sub: sub,
    nonce: opt?.nonce ?? faker.string.uuid(),
    sub_jwk: jwk,
    iat: opt?.iat,
    exp: opt?.exp,
  };
  // const privateKey = await jose.importJWK(privateJwk, "ES256");
  // const jwt = await new jose.SignJWT(idTokenPayload)
  //   .setProtectedHeader({ alg: "ES256" })
  //   .sign(privateKey);
  // return jwt;
  return await issueJwt({ alg: "ES256" }, idTokenPayload, privateJwk);
};

export const extractSub = (jwt: string) => {
  const { sub } = jose.decodeJwt(jwt);
  return sub;
};

export const getClaimJwt = async (payload: any) => {
  const privateJwk = ellipticJwk.newPrivateJwk("P-256");
  // const privateKey = await jose.importJWK(privateJwk, "ES256");
  // const jwk = publicJwkFromPrivate(privateJwk);
  // return await new jose.SignJWT(payload)
  //   .setProtectedHeader({ alg: "ES256", jwk })
  //   .setIssuedAt()
  //   .setAudience(process.env.CREDENTIAL_ISSUER || "")
  //   .setExpirationTime("2h")
  //   .sign(privateKey);
  return await issueJwt({ alg: "ES256" }, payload, privateJwk);
};

export const createImage = (format: string = "png") => {
  const image: ImageDocument = {
    url: faker.image.urlPlaceholder({ format }),
    type: format,
    height: faker.number.int(),
    width: faker.number.int(),
    alt: faker.string.alpha(10),
  };
  return image;
};

export const createClaimer = (opt: Partial<ClaimerDocument> = {}) => {
  const claimer: ClaimerDocument = {
    id: opt.id ?? faker.string.uuid(),
    id_token: opt.id_token ?? faker.string.alpha(),
    sub: opt.sub ?? faker.string.uuid(),
    icon: opt.icon ?? faker.image.dataUri({ type: "svg-base64" }),
    created_at: opt.created_at ?? faker.date.past().toISOString(),
  };
  return claimer;
};

export const createAffiliation = (opt: Partial<AffiliationDocument> = {}) => {
  const affiliation: AffiliationDocument = {
    id: opt.id ?? faker.string.uuid(),
    claimer_id: opt.claimer_id ?? faker.string.uuid(),
    claimer_sub: opt.claimer_sub ?? faker.string.uuid(),
    organization: opt.organization ?? faker.string.alpha(10),
    created_at: opt.created_at ?? faker.date.past().toISOString(),
  };
  return affiliation;
};

export const createUrl = (opt: Partial<UrlDocument> = {}) => {
  const url = opt.url ?? faker.internet.url();
  const urlDoc: UrlDocument = {
    id: faker.string.uuid(),
    url,
    domain: getFQDN(url) || "",
    title: opt.title ?? faker.string.alpha(10),
    content_type: opt.content_type ?? "text/html",
    description: opt.description ?? faker.string.alpha(20),
    image: opt.image ?? "",
    created_at: opt.created_at ?? faker.date.past().toISOString(),
  };
  return urlDoc;
};

export const createClaim = (opt: Partial<ClaimDocument> = {}) => {
  const claim: ClaimDocument = {
    id: faker.string.uuid(),
    url: opt.url ?? faker.internet.url(),
    claimer_id: opt.claimer_id ?? faker.string.uuid(),
    affiliation_id: opt.affiliation_id ?? faker.string.uuid(),
    comment: opt.comment ?? faker.string.alpha(10),
    created_at: opt.created_at ?? faker.date.past().toISOString(),
  };
  return claim;
};

export const generatePaths = () => {
  const ipfsPath = generateTemporaryPath("ipfs", "blocks");
  const orbitdbPath = generateTemporaryPath("orbitdb");
  const keystorePath = generateTemporaryPath("keystore");

  return { ipfsPath, orbitdbPath, keystorePath };
};

export const extractPublicKeyFromX5c = async (jwt: string, alg: string) => {
  const decodedHeader = jose.decodeProtectedHeader(jwt);
  const leafKey = decodedHeader.x5c![0];
  const leafKeyX509 = `${CERT_PEM_PREAMBLE}\n${leafKey}\n${CERT_PEM_POSTAMBLE}`;

  return await jose.importX509(leafKeyX509, alg);
};
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
