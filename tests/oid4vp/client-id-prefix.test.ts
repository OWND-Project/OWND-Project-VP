import { describe, it, before } from "mocha";
import { assert } from "chai";
import ellipticJwk from "elliptic-jwk";
import {
  parseClientId,
  formatClientId,
  calculateX509Hash,
  validateClientId,
} from "../../src/oid4vp/client-id-utils.js";
import { generateCertPem } from "./test-utils.js";

describe("Client Identifier Prefix", () => {
  describe("parseClientId", () => {
    it("should parse redirect_uri prefix", () => {
      const result = parseClientId("redirect_uri:https://example.org/cb");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "redirect_uri");
      assert.equal(result?.value, "https://example.org/cb");
      assert.equal(result?.raw, "redirect_uri:https://example.org/cb");
    });

    it("should parse x509_san_dns prefix", () => {
      const result = parseClientId("x509_san_dns:client.example.org");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "x509_san_dns");
      assert.equal(result?.value, "client.example.org");
      assert.equal(result?.raw, "x509_san_dns:client.example.org");
    });

    it("should parse x509_hash prefix", () => {
      const result = parseClientId(
        "x509_hash:Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk",
      );
      assert.isNotNull(result);
      assert.equal(result?.prefix, "x509_hash");
      assert.equal(
        result?.value,
        "Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk",
      );
    });

    it("should return null for invalid prefix", () => {
      const result = parseClientId("http://example.org");
      assert.isNull(result);
    });

    it("should return null for empty string", () => {
      const result = parseClientId("");
      assert.isNull(result);
    });

    it("should handle prefix without value", () => {
      const result = parseClientId("redirect_uri:");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "redirect_uri");
      assert.equal(result?.value, "");
    });
  });

  describe("formatClientId", () => {
    it("should format redirect_uri prefix", () => {
      const result = formatClientId("redirect_uri", "https://example.org/cb");
      assert.equal(result, "redirect_uri:https://example.org/cb");
    });

    it("should format x509_san_dns prefix", () => {
      const result = formatClientId("x509_san_dns", "client.example.org");
      assert.equal(result, "x509_san_dns:client.example.org");
    });

    it("should format x509_hash prefix", () => {
      const result = formatClientId(
        "x509_hash",
        "Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk",
      );
      assert.equal(
        result,
        "x509_hash:Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk",
      );
    });

    it("should handle empty value", () => {
      const result = formatClientId("redirect_uri", "");
      assert.equal(result, "redirect_uri:");
    });
  });

  describe("calculateX509Hash", () => {
    let testCertPem: string;
    let anotherCertPem: string;

    before(async () => {
      // Generate test certificates
      const privateJwk1 = ellipticJwk.newPrivateJwk("P-256");
      const privateJwk2 = ellipticJwk.newPrivateJwk("P-256");

      testCertPem = await generateCertPem(
        "/C=JP/ST=Tokyo/O=Test Org/CN=test.example.org",
        privateJwk1,
      );
      anotherCertPem = await generateCertPem(
        "/C=JP/ST=Tokyo/O=Another Org/CN=another.example.org",
        privateJwk2,
      );
    });

    it("should calculate SHA-256 hash correctly", () => {
      const hash = calculateX509Hash(testCertPem);

      // Base64URL形式の検証
      assert.match(hash, /^[A-Za-z0-9_-]+$/);
      // SHA-256 (32 bytes) → Base64URL (43 chars without padding)
      assert.equal(hash.length, 43);
    });

    it("should produce consistent hashes", () => {
      const hash1 = calculateX509Hash(testCertPem);
      const hash2 = calculateX509Hash(testCertPem);

      assert.equal(hash1, hash2);
    });

    it("should produce different hashes for different certificates", () => {
      const hash1 = calculateX509Hash(testCertPem);
      const hash2 = calculateX509Hash(anotherCertPem);

      assert.notEqual(hash1, hash2);
    });

    it("should not contain Base64 padding characters", () => {
      const hash = calculateX509Hash(testCertPem);

      assert.notInclude(hash, "=");
    });

    it("should not contain + or / characters", () => {
      const hash = calculateX509Hash(testCertPem);

      assert.notInclude(hash, "+");
      assert.notInclude(hash, "/");
    });
  });

  describe("validateClientId", () => {
    describe("redirect_uri prefix", () => {
      it("should validate valid redirect_uri", () => {
        const result = validateClientId("redirect_uri:https://example.org/cb");
        assert.isTrue(result.valid);
        assert.isUndefined(result.error);
      });

      it("should validate redirect_uri with port", () => {
        const result = validateClientId(
          "redirect_uri:https://example.org:8080/cb",
        );
        assert.isTrue(result.valid);
      });

      it("should validate redirect_uri with query parameters", () => {
        const result = validateClientId(
          "redirect_uri:https://example.org/cb?code=123",
        );
        assert.isTrue(result.valid);
      });

      it("should reject invalid URL", () => {
        const result = validateClientId("redirect_uri:not-a-url");
        assert.isFalse(result.valid);
        assert.include(result.error!, "Invalid URL");
      });

      it("should reject empty URL", () => {
        const result = validateClientId("redirect_uri:");
        assert.isFalse(result.valid);
        assert.include(result.error!, "Invalid URL");
      });
    });

    describe("x509_san_dns prefix", () => {
      let certWithSan: string;

      before(async () => {
        // Certificate with SAN DNS:example.com (generated by generateCertPem)
        const privateJwk = ellipticJwk.newPrivateJwk("P-256");
        certWithSan = await generateCertPem(
          "/C=JP/ST=Tokyo/O=Test Org/CN=client.example.org",
          privateJwk,
        );
      });

      it("should validate matching SAN DNS name", () => {
        // generateCert always adds "example.com" as SAN
        const result = validateClientId("x509_san_dns:example.com", [
          certWithSan,
        ]);
        assert.isTrue(result.valid);
      });

      it("should reject non-matching SAN DNS name", () => {
        const result = validateClientId(
          "x509_san_dns:wrong.example.org",
          [certWithSan],
        );
        assert.isFalse(result.valid);
        assert.include(result.error!, "does not match SAN DNS names");
      });

      it("should require x5c header", () => {
        const result = validateClientId("x509_san_dns:client.example.org");
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });

      it("should reject empty x5c array", () => {
        const result = validateClientId("x509_san_dns:client.example.org", []);
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });
    });

    describe("x509_hash prefix", () => {
      let testCert: string;

      before(async () => {
        const privateJwk = ellipticJwk.newPrivateJwk("P-256");
        testCert = await generateCertPem(
          "/C=JP/ST=Tokyo/O=Hash Test Org/CN=hash.example.org",
          privateJwk,
        );
      });

      it("should validate matching certificate hash", () => {
        const hash = calculateX509Hash(testCert);
        const result = validateClientId(`x509_hash:${hash}`, [testCert]);
        assert.isTrue(result.valid);
      });

      it("should reject non-matching certificate hash", () => {
        const result = validateClientId("x509_hash:InvalidHashValue123", [
          testCert,
        ]);
        assert.isFalse(result.valid);
        assert.include(result.error!, "Certificate hash mismatch");
      });

      it("should require x5c header", () => {
        const result = validateClientId("x509_hash:SomeHash123");
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });

      it("should reject empty x5c array", () => {
        const result = validateClientId("x509_hash:SomeHash123", []);
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });
    });

    describe("no prefix", () => {
      it("should reject client ID without prefix", () => {
        const result = validateClientId("http://example.org");
        assert.isFalse(result.valid);
        assert.include(result.error!, "No valid Client Identifier Prefix");
      });
    });
  });
});
