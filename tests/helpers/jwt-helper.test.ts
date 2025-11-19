import { describe, it } from "mocha";
import { expect } from "chai";
import {
  generateEphemeralKeyPair,
  decryptJWE,
} from "../../src/helpers/jwt-helper.js";
import { CompactEncrypt, importJWK } from "jose";

describe("JWT Helper - JWE Encryption", () => {
  describe("#generateEphemeralKeyPair", () => {
    it("should generate ECDH-ES key pair with P-256 curve", async () => {
      const { publicJwk, privateJwk, kid } = await generateEphemeralKeyPair();

      expect(publicJwk.kty).to.equal("EC");
      expect(publicJwk.crv).to.equal("P-256");
      expect(publicJwk.use).to.equal("enc");
      expect(publicJwk.alg).to.equal("ECDH-ES");
      expect(publicJwk.kid).to.equal(kid);
      expect(publicJwk.x).to.exist;
      expect(publicJwk.y).to.exist;

      expect(privateJwk.kty).to.equal("EC");
      expect(privateJwk.crv).to.equal("P-256");
      expect(privateJwk.kid).to.equal(kid);
      expect(privateJwk.d).to.exist;
    });
  });

  describe("#decryptJWE", () => {
    it("should decrypt JWE encrypted with ECDH-ES + A128GCM", async () => {
      const { publicJwk, privateJwk } = await generateEphemeralKeyPair();

      const payload = {
        vp_token: {
          test_credential: ["eyJhbGci..."],
        },
      };
      const publicKey = await importJWK(publicJwk, "ECDH-ES");
      const jwe = await new CompactEncrypt(
        new TextEncoder().encode(JSON.stringify(payload)),
      )
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A128GCM",
          kid: publicJwk.kid,
        })
        .encrypt(publicKey);

      const decrypted = await decryptJWE(jwe, privateJwk);

      expect(decrypted).to.deep.equal(payload);
    });
  });
});
