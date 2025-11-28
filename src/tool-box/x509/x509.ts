import tls from "tls";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import * as pvutils from "pvutils";
import { CERT_PEM_POSTAMBLE } from "./constant.js";
import { getCustomTrustedCertificates } from "../../helpers/certificate-loader.js";
import getLogger from "../../services/logging-service.js";

const logger = getLogger();

interface CertificateInfo {
  subject: {
    commonName: string;
    organizationName: string;
    organizationalUnitName?: string;
    countryName?: string;
    stateOrProvinceName?: string;
    localityName?: string;
  };
  issuer: {
    commonName: string;
    organizationName: string;
    organizationalUnitName?: string;
    countryName?: string;
    stateOrProvinceName?: string;
    localityName?: string;
  };
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}

export const certificateStr2Array = (certs: string) => {
  return certs
    .replace(/\\n/g, "\n") // for reading from .env file in which `\n` string is placed instead of new line code.
    .split(CERT_PEM_POSTAMBLE)
    .map((cert) => {
      const pem = cert
        .replace(/-----BEGIN CERTIFICATE-----/, "")
        .replace(/\n/g, "");
      return pem;
    })
    .filter((cert) => cert);
};

const extractCertificateInfo = (cert: pkijs.Certificate): CertificateInfo => {
  const getName = (name: pkijs.RelativeDistinguishedNames) => {
    const attributes = name.typesAndValues.reduce(
      (acc: any, typeAndValue: pkijs.AttributeTypeAndValue) => {
        const type = typeAndValue.type;
        const value = typeAndValue.value.valueBlock.value;
        switch (type) {
          case "2.5.4.3": // commonName
            acc.commonName = value;
            break;
          case "2.5.4.10": // organizationName
            acc.organizationName = value;
            break;
          case "2.5.4.11": // organizationalUnitName
            acc.organizationalUnitName = value;
            break;
          case "2.5.4.6": // countryName
            acc.countryName = value;
            break;
          case "2.5.4.8": // stateOrProvinceName
            acc.stateOrProvinceName = value;
            break;
          case "2.5.4.7": // localityName
            acc.localityName = value;
            break;
        }
        return acc;
      },
      {},
    );
    return attributes;
  };

  return {
    subject: getName(cert.subject),
    issuer: getName(cert.issuer),
    serialNumber: pvutils.bufferToHexCodes(
      cert.serialNumber.valueBlock.valueHexView.slice().buffer,
    ),
    notBefore: cert.notBefore.value,
    notAfter: cert.notAfter.value,
  };
};

export const getCertificatesInfo = (certs: string[]): CertificateInfo[] => {
  return certs.map((certString) => {
    const asn1Cert = asn1js.fromBER(
      pvutils.stringToArrayBuffer(pvutils.fromBase64(certString)),
    );
    if (asn1Cert.offset === -1) {
      throw new Error("Error decoding certificate");
    }
    const cert = new pkijs.Certificate({ schema: asn1Cert.result });
    return extractCertificateInfo(cert);
  });
};

/**
 * Base64エンコードされた証明書をpkijs.Certificateに変換
 */
const base64ToPkijsCert = (base64Cert: string): pkijs.Certificate => {
  const der = Buffer.from(base64Cert, "base64");
  const asn1 = asn1js.fromBER(der);
  if (asn1.offset === -1) {
    throw new Error("Error parsing ASN.1 data");
  }
  return new pkijs.Certificate({ schema: asn1.result });
};

export const verifyCertificateChain = async (
  certs: string[],
): Promise<void> => {
  logger.info(
    `[Certificate Chain] Starting verification: ${certs.length} certificate(s) in chain`,
  );

  // システムのルート証明書を信頼リストに追加
  const systemCertsCount = tls.rootCertificates.length;
  const trustedCerts: pkijs.Certificate[] = tls.rootCertificates.map((cert) => {
    const pem = cert
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\n/g, "");
    return base64ToPkijsCert(pem);
  });

  // カスタム信頼証明書（中間証明書、ルート証明書）を追加
  const customCerts = getCustomTrustedCertificates();
  let customCertsLoaded = 0;
  for (const customCert of customCerts) {
    try {
      const pkijsCert = base64ToPkijsCert(customCert);
      trustedCerts.push(pkijsCert);
      customCertsLoaded++;
    } catch (error) {
      logger.warn(`[Certificate Chain] Failed to parse custom trusted certificate: ${error}`);
    }
  }

  logger.info(
    `[Certificate Chain] Trust anchors: system=${systemCertsCount}, custom=${customCertsLoaded}, total=${trustedCerts.length}`,
  );

  // 検証対象の証明書チェーンを変換
  const certsArray: pkijs.Certificate[] = certs.map((cert) => {
    const asn1Cert = asn1js.fromBER(
      pvutils.stringToArrayBuffer(pvutils.fromBase64(cert)),
    );
    if (asn1Cert.offset === -1) {
      throw new Error("Error decoding certificate");
    }
    return new pkijs.Certificate({ schema: asn1Cert.result });
  });

  // リーフ証明書の情報をログ出力
  if (certsArray.length > 0) {
    const leafCert = certsArray[0];
    const leafInfo = extractCertificateInfo(leafCert);
    logger.info(
      `[Certificate Chain] Leaf certificate: subject.CN=${leafInfo.subject.commonName || "N/A"}, ` +
        `subject.O=${leafInfo.subject.organizationName || "N/A"}, ` +
        `issuer.CN=${leafInfo.issuer.commonName || "N/A"}, ` +
        `issuer.O=${leafInfo.issuer.organizationName || "N/A"}`,
    );
  }

  // https://pkijs.org/docs/api/classes/CertificateChainValidationEngine/
  const certChainEngine = new pkijs.CertificateChainValidationEngine({
    certs: certsArray,
    trustedCerts,
  });

  logger.info(`[Certificate Chain] Executing certificate chain verification...`);
  const result = await certChainEngine.verify();

  if (!result.result) {
    const errorMessage = result.resultMessage || "Unknown error";
    logger.error(
      `[Certificate Chain] Verification FAILED: ${errorMessage}`,
    );
    throw new Error(`Certificate chain verification failed: ${errorMessage}`);
  }

  logger.info(`[Certificate Chain] Verification SUCCESS`);
};

import("node:crypto").then((crypto) => {
  console.debug("setup pki.js");
  if ("webcrypto" in crypto) {
    const name = "NodeJS ^15";
    const nodeCrypto = (crypto as any).webcrypto as Crypto;
    // @ts-ignore
    pkijs.setEngine(name, new pkijs.CryptoEngine({ name, crypto: nodeCrypto }));
  } else {
    throw new Error("Certificate chain verification setup failed");
  }
});
