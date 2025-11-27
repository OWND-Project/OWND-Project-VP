import tls from "tls";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import * as pvutils from "pvutils";
import { CERT_PEM_POSTAMBLE } from "./constant.js";
import { getCustomTrustedCertificates } from "../../helpers/certificate-loader.js";

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
  // システムのルート証明書を信頼リストに追加
  const trustedCerts: pkijs.Certificate[] = tls.rootCertificates.map((cert) => {
    const pem = cert
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\n/g, "");
    return base64ToPkijsCert(pem);
  });

  // カスタム信頼証明書（中間証明書、ルート証明書）を追加
  const customCerts = getCustomTrustedCertificates();
  for (const customCert of customCerts) {
    try {
      const pkijsCert = base64ToPkijsCert(customCert);
      trustedCerts.push(pkijsCert);
    } catch (error) {
      console.warn("Failed to parse custom trusted certificate:", error);
    }
  }

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

  // https://pkijs.org/docs/api/classes/CertificateChainValidationEngine/
  const certChainEngine = new pkijs.CertificateChainValidationEngine({
    certs: certsArray,
    trustedCerts,
  });

  const result = await certChainEngine.verify();
  if (!result.result) {
    throw new Error("Certificate chain verification failed");
  }
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
