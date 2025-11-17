import ellipticJwk, { PrivateJwk } from "elliptic-jwk";
import {
  generateRootCertificate,
  generateCsr,
  trimmer,
} from "../../src/tool-box/x509/issue.js";
import { getKeyAlgorithm, ellipticJwkToPem } from "../../src/tool-box/util.js";
import * as datetimeUtils from "../../src/tool-box/datetime.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";

export const generateCert = async (subject: string, privateJwk: PrivateJwk) => {
  const keyPair = await ellipticJwkToPem(privateJwk);
  const extension = [
    { extname: "subjectAltName", array: [{ dns: "example.com" }] },
  ];
  const csr = trimmer(
    generateCsr(
      subject,
      keyPair.publicKey,
      keyPair.privateKey,
      "SHA256withECDSA",
      extension,
    ),
  );
  const notBefore = datetimeUtils.getCurrentUTCDate();
  const notAfter = datetimeUtils.addSeconds(notBefore, 86400 * 365);
  const cert = trimmer(
    generateRootCertificate(
      csr,
      notBefore,
      notAfter,
      "SHA256withECDSA",
      keyPair.privateKey,
    ),
  );
  return cert;
};

export const issueJwtUsingX5C = async (
  payload: any,
  subject: string,
  privateJwk: PrivateJwk,
) => {
  // const subject = "/C=JP/ST=Tokyo/L=Chiyoda-ku/O=Example Company/CN=example.jp";
  // const privateJwk = ellipticJwk.newPrivateJwk("P-256");
  const cert = await generateCert(subject, privateJwk);
  const x5c = [cert];

  let alg = getKeyAlgorithm(privateJwk);
  let basicHeader = { alg: alg, typ: "JWT" };
  let header = { ...basicHeader, x5c };

  return await issueJwt(header, payload, privateJwk);
};
