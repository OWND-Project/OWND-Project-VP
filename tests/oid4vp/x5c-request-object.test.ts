import { describe, it, before } from "mocha";
import { assert } from "chai";
import ellipticJwk, { PrivateJwk } from "elliptic-jwk";
import { decodeProtectedHeader, decodeJwt } from "jose";

import {
  generateRequestObjectJwt,
  GenerateRequestObjectOptions,
} from "../../src/oid4vp/auth-request.js";
import { verifyJwt } from "../../src/tool-box/verify.js";
import {
  calculateX509Hash,
  validateClientId,
} from "../../src/oid4vp/client-id-utils.js";
import { generateCert, generateCertPem } from "./test-utils.js";

/**
 * Convert Base64 DER certificate to PEM format
 * This is needed because x5c header contains Base64 DER, but validateClientId expects PEM
 */
function x5cToPem(x5cBase64: string): string {
  return `-----BEGIN CERTIFICATE-----\n${x5cBase64}\n-----END CERTIFICATE-----`;
}

describe("x5c Request Object Signature Verification", () => {
  let privateJwk: PrivateJwk;
  let certBase64: string;
  let certPem: string;
  let x509Hash: string;
  let clientId: string;

  before(async () => {
    // Generate test key pair and certificate
    privateJwk = ellipticJwk.newPrivateJwk("P-256");
    certBase64 = await generateCert(
      "/C=JP/ST=Tokyo/O=Test Verifier/CN=verifier.example.org",
      privateJwk,
    );
    certPem = `-----BEGIN CERTIFICATE-----\n${certBase64}\n-----END CERTIFICATE-----`;

    // Calculate x509_hash from certificate
    x509Hash = calculateX509Hash(certPem);
    clientId = `x509_hash:${x509Hash}`;
  });

  describe("Request Object Generation with x5c", () => {
    it("should generate request object JWT with correct header and payload", async () => {
      const options: GenerateRequestObjectOptions = {
        responseUri: "https://verifier.example.org/response",
        responseMode: "direct_post",
        x509CertificateInfo: {
          x5c: [certBase64],
        },
        nonce: "test-nonce-12345",
        state: "test-state-67890",
      };

      const jwt = await generateRequestObjectJwt(clientId, privateJwk, options);

      // Verify JWT structure
      assert.isString(jwt);
      const parts = jwt.split(".");
      assert.equal(parts.length, 3, "JWT should have 3 parts");

      // Verify header
      const header = decodeProtectedHeader(jwt);
      assert.equal(header.alg, "ES256");
      assert.equal(header.typ, "oauth-authz-req+jwt");
      assert.isArray(header.x5c);
      assert.equal(header.x5c![0], certBase64);

      // Verify payload
      const payload = decodeJwt(jwt);
      assert.equal(payload.client_id, clientId);
      assert.equal(payload.response_uri, "https://verifier.example.org/response");
      assert.equal(payload.response_mode, "direct_post");
      assert.equal(payload.response_type, "vp_token");
      assert.equal(payload.nonce, "test-nonce-12345");
      assert.equal(payload.state, "test-state-67890");
      assert.equal(payload.iss, clientId);
      assert.equal(payload.aud, "https://self-issued.me/v2");
    });
  });

  describe("Request Object Signature Verification with x5c", () => {
    it("should verify request object signed with x5c certificate", async () => {
      const options: GenerateRequestObjectOptions = {
        responseUri: "https://verifier.example.org/response",
        x509CertificateInfo: {
          x5c: [certBase64],
        },
      };

      const jwt = await generateRequestObjectJwt(clientId, privateJwk, options);

      // Verify signature using verifyJwt (which extracts public key from x5c)
      const result = await verifyJwt<any>(jwt, { skipVerifyChain: true });

      assert.isTrue(result.ok, "Signature verification should succeed");
      if (result.ok) {
        assert.equal(result.payload.client_id, clientId);
        assert.equal(result.payload.response_uri, "https://verifier.example.org/response");
      }
    });

    it("should fail verification when JWT is tampered", async () => {
      const options: GenerateRequestObjectOptions = {
        responseUri: "https://verifier.example.org/response",
        x509CertificateInfo: {
          x5c: [certBase64],
        },
      };

      const jwt = await generateRequestObjectJwt(clientId, privateJwk, options);

      // Tamper with the payload (change a character in the middle part)
      const parts = jwt.split(".");
      const tamperedPayload = parts[1].slice(0, -5) + "XXXXX";
      const tamperedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = await verifyJwt<any>(tamperedJwt, { skipVerifyChain: true });

      assert.isFalse(result.ok, "Tampered JWT should fail verification");
    });

    it("should fail verification when signed with different key", async () => {
      // Generate a different key pair
      const differentPrivateJwk = ellipticJwk.newPrivateJwk("P-256");

      // Create request object with original certificate in header
      // but sign with different key
      const options: GenerateRequestObjectOptions = {
        responseUri: "https://verifier.example.org/response",
        x509CertificateInfo: {
          x5c: [certBase64], // Original certificate
        },
      };

      // Sign with different key (mismatch between x5c cert and signing key)
      const jwt = await generateRequestObjectJwt(
        clientId,
        differentPrivateJwk, // Different key!
        options,
      );

      // Verification should fail because signature doesn't match x5c public key
      const result = await verifyJwt<any>(jwt, { skipVerifyChain: true });

      assert.isFalse(result.ok, "JWT signed with wrong key should fail verification");
    });
  });

  describe("Client ID Validation with x509_hash", () => {
    it("should validate client_id matches certificate hash", async () => {
      const options: GenerateRequestObjectOptions = {
        responseUri: "https://verifier.example.org/response",
        x509CertificateInfo: {
          x5c: [certBase64],
        },
      };

      const jwt = await generateRequestObjectJwt(clientId, privateJwk, options);
      const header = decodeProtectedHeader(jwt);
      const payload = decodeJwt(jwt);

      // Validate client_id using x5c from header (convert to PEM first)
      const x5cPem = header.x5c!.map(x5cToPem);
      const validation = validateClientId(
        payload.client_id as string,
        x5cPem,
      );

      assert.isTrue(validation.valid, "Client ID should match certificate hash");
    });

    it("should fail validation when client_id hash doesn't match certificate", async () => {
      // Generate a different certificate
      const differentPrivateJwk = ellipticJwk.newPrivateJwk("P-256");
      const differentCertBase64 = await generateCert(
        "/C=JP/ST=Tokyo/O=Different Org/CN=different.example.org",
        differentPrivateJwk,
      );

      // Validate using original client_id but different certificate (convert to PEM)
      const validation = validateClientId(clientId, [x5cToPem(differentCertBase64)]);

      assert.isFalse(validation.valid, "Validation should fail for mismatched hash");
      assert.include(validation.error!, "Certificate hash mismatch");
    });
  });

});
