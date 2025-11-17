import { assert } from "chai";

import {
  extractFromPath,
  getDescriptorMap,
  extractPresentation,
  extractNestedCredential,
  extractCredential,
} from "../../src/oid4vp/verify.js";
import {
  DescriptorMap,
  VerifiableCredential,
  VerifiablePresentationJWTPayload,
} from "../../src/oid4vp/types.js";
import { faker } from "@faker-js/faker";
import { createKeyPair, createSdJwt } from "../test-utils.js";
import { issueJwt, verifySdJwt } from "../../src/helpers/jwt-helper.js";
import { SDJWT, SDJWTPayload } from "@meeco/sd-jwt";

import { TokenType } from "../../src/usecases/types.js";
import {
  verifyVcForW3CVcDataV1,
  verifyVpForW3CVcDataV1,
} from "../../src/tool-box/index.js";
import { publicJwkFromPrivate } from "elliptic-jwk";
import { verifySdJwtWrapper } from "../../src/usecases/internal/credential2-processor.js";

const jwt_vc_json = {
  alg: ["ES256"],
};

describe("Verify", () => {
  type Cred1 = { claim1: string };
  const w3cVpPath = "$.vp.verifiableCredential[0]";
  describe("#getDescriptorMap", () => {
    const id = faker.string.uuid();
    const inputDescriptor = {
      id,
      format: { jwt_vc_json },
      constraints: {},
    };
    const mapVp = {
      id,
      path: "$",
      format: "jwt_vp_json",
    };

    describe("compare by only id", () => {
      it("should be false", async () => {
        // prepare
        const map1: DescriptorMap = { ...mapVp, id: "fake id" };
        const descriptorMap = [map1];

        // execute
        const ret = getDescriptorMap(inputDescriptor, descriptorMap);

        // assert
        assert.isNull(ret);
      });
      it("should be true", async () => {
        // prepare
        const map1: DescriptorMap = { ...mapVp, id: faker.string.uuid() };
        const map2: DescriptorMap = { ...mapVp, id };
        const descriptorMap = [map1, map2];

        // execute
        const ret = getDescriptorMap(inputDescriptor, descriptorMap);

        // assert
        assert.equal(ret, map2);
      });
    });
    describe("compare by id and format", () => {
      it("should be false", async () => {
        // prepare
        const map1: DescriptorMap = {
          ...mapVp,
          pathNested: { path: w3cVpPath, format: "no-such-format" },
        };
        const descriptorMap = [map1];

        // execute
        const ret = getDescriptorMap(inputDescriptor, descriptorMap, true);

        // assert
        assert.isNull(ret);
      });
      it("should be true", async () => {
        // prepare
        const map1: DescriptorMap = {
          ...mapVp,
          pathNested: { path: w3cVpPath, format: "jwt_vc_json" },
        };
        const descriptorMap = [map1];

        // execute
        const ret = getDescriptorMap(inputDescriptor, descriptorMap, true);

        // assert
        assert.equal(ret, map1);
      });
    });
  });

  describe("#extractFromPath", () => {
    const credential1 = { claim1: 1 };
    const credential2 = { claim1: 2 };
    const token = { vp: { verifiableCredential: [credential1, credential2] } };
    const token2 = { vp: { verifiableCredential: [credential1, credential2] } };
    describe("get root", () => {
      it("should extract token1", () => {
        const ret = extractFromPath("$", token);
        assert.equal(ret, token);
      });
      it("should extract token2", () => {
        const ret = extractFromPath("$[1]", [token, token2]);
        assert.equal(ret, token2);
      });
    });
    describe("single token", () => {
      it("should extract claim1", () => {
        const ret = extractFromPath("$.vp.verifiableCredential[0]", token);
        assert.equal(ret, credential1);
      });
      it("should extract claim2", () => {
        const ret = extractFromPath("$.vp.verifiableCredential[1]", token);
        assert.equal(ret, credential2);
      });
    });
    describe("multiple tokens", () => {
      const tokens = [token, token2];
      it("should extract claim1", () => {
        const ret = extractFromPath("$[0].vp.verifiableCredential[0]", tokens);
        assert.equal(ret, credential1);
      });
      it("should extract claim2", () => {
        const ret = extractFromPath("$[1].vp.verifiableCredential[1]", tokens);
        assert.equal(ret, credential2);
      });
    });
  });

  type Decoded = VerifiablePresentationJWTPayload;
  describe("#extractPresentation", () => {
    const id = faker.string.uuid();
    const keyPair = createKeyPair();
    const header = { alg: "ES256", jwk: publicJwkFromPrivate(keyPair) };
    const holderKeyPair = createKeyPair();
    let vc: string;
    let vpToken: string;
    beforeEach(async () => {
      const credential = {
        vc: { credentialSubject: { claim1: "foo" } },
      };
      vc = await issueJwt(header, credential, keyPair);
      const presentation = {
        vp: { verifiableCredential: [vc] },
      };
      vpToken = await issueJwt(header, presentation, holderKeyPair);
    });
    describe("ng cases", () => {
      it("should return not found error", async () => {
        // prepare
        const descriptorMap = { id, path: "$[1]", format: "jwt_vp_json" };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          [vpToken],
          descriptorMap,
        );

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        const { type } = result.error;
        assert.equal(type, "UNMATCHED_PATH");
      });

      it("should return unsupported format error", async () => {
        // prepare
        const descriptorMap = { id, path: "$", format: "no-such-format" };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          vpToken,
          descriptorMap,
        );

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        const { type } = result.error;
        assert.equal(type, "UNSUPPORTED_FORMAT");
      });

      it("should return decode error", async () => {
        // prepare
        const descriptorMap = { id, path: "$", format: "jwt_vp_json" };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          "non-jwt-value",
          descriptorMap,
        );

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        const { type } = result.error;
        assert.equal(type, "DECODE_FAILURE");
      });

      it("should return validate error", async () => {
        // prepare
        const wrongKeyPair = createKeyPair();
        const presentation = {
          vp: { verifiableCredential: [vc] },
        };
        vpToken = await issueJwt(header, presentation, holderKeyPair);
        const descriptorMap = { id, path: "$", format: "jwt_vp_json" };
        const verifyFunction = async (credential: string) => {
          return await verifyVpForW3CVcDataV1<string>(credential, {
            jwk: wrongKeyPair,
            alg: "ES256",
          });
        };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          vpToken,
          descriptorMap,
          { verifier: verifyFunction },
        );

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        const { type } = result.error;
        assert.equal(type, "VALIDATE_FAILURE");
      });
    });

    describe("jwt_vp_json", () => {
      it("should return decoded verifiable presentation(1 of 1", async () => {
        // prepare
        const descriptorMap = {
          id: "id_credential",
          path: "$",
          format: "jwt_vp_json",
        };
        const verifyFunction = async (credential: string) => {
          return await verifyVpForW3CVcDataV1<string>(credential, {
            jwk: holderKeyPair,
            alg: "ES256",
          });
        };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          vpToken,
          descriptorMap,
          { verifier: verifyFunction },
        );

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { decoded, raw } = result.payload;
        assert.equal(decoded.vp.verifiableCredential[0], vc);
        assert.equal(raw, vpToken);
      });
      it("should return decoded verifiable presentation(1 of 2", async () => {
        // prepare
        const descriptorMap = {
          id: "id_credential",
          path: "$[1]",
          format: "jwt_vp_json",
        };

        // execute
        const result = await extractPresentation<TokenType, Decoded>(
          ["dummy token", vpToken],
          descriptorMap,
        );

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { decoded, raw } = result.payload;
        assert.equal(decoded.vp.verifiableCredential[0], vc);
        assert.equal(raw, vpToken);
      });
    });
    describe("vc+sd-jwt", () => {
      it("should return decoded verifiable presentation(1 of 2", async () => {
        // prepare
        const descriptorMap = {
          id: faker.string.uuid(),
          path: "$[1]",
          format: "vc+sd-jwt",
        };
        const sdJwt = await createSdJwt({ claim1: "foo" }, ["claim1"], {
          issuerPrivateJwk: keyPair,
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: "dummy" },
          holderKeyPair,
        );
        // const kbJwt = await signPayload({ nonce: "dummy" }, holderKeyPair);
        const vpToken = sdJwt + kbJwt;

        // execute
        const result = await extractPresentation<TokenType, SDJWT>(
          ["dummy token", vpToken],
          descriptorMap,
        );

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { decoded, raw } = result.payload;
        const { disclosures } = decoded;
        assert.equal(disclosures[0].key, "claim1");
        assert.equal(disclosures[0].value, "foo");
        assert.equal(raw, vpToken);
      });
    });
  });
  describe("#extractNestedCredential", () => {
    const secret = new TextEncoder().encode(
      "cc7e0d44fd473002f1c42167459001140ec6389b7353f8088f4d9a95f2f596f2",
    );
    describe("jwt_vc_json", () => {
      const verifyFunction = async (credential: string) => {
        return await verifyVcForW3CVcDataV1<Cred1>(credential, {
          secret,
        });
      };
      it("should return decoded verifiable credential when vp_token is a single token", async () => {
        // prepare
        const credential = {
          vc: { credentialSubject: { claim1: "foo" } },
        };
        const header = { alg: "HS256" };
        const vc = await issueJwt(header, credential, secret);
        const presentation = {
          vp: { verifiableCredential: [vc] },
        };
        const pathNested = {
          format: "jwt_vc_json",
          path: "$.vp.verifiableCredential[0]",
        };

        // execute
        const opts = { verifier: verifyFunction };
        const result = await extractNestedCredential<
          string,
          VerifiableCredential<Cred1>
        >(presentation, pathNested.format, pathNested.path, opts);

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { decoded, raw } = result.payload;
        assert.equal(decoded.vc.credentialSubject.claim1, "foo");
        assert.equal(raw, vc);
      });
    });
  });
  describe("#extractCredential", () => {
    describe("sd+jwt-vc", () => {
      const issueKeyPair = createKeyPair();
      const descriptorMap = {
        path: "$",
        format: "vc+sd-jwt",
      };
      it("should return decoded sd-jwt when vp_token is a single token", async () => {
        // prepare
        const iss = faker.internet.url();
        const holderKeyPair = createKeyPair();
        const sdJwt = await createSdJwt({ claim1: "foo" }, ["claim1"], {
          issuerPrivateJwk: issueKeyPair,
          holderPublicJwk: holderKeyPair,
          iss,
        });
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: "dummy" },
          holderKeyPair,
        );
        const vpToken = sdJwt + kbJwt;

        // execute
        const opts = { verifier: verifySdJwtWrapper };
        const result = await extractCredential<string, SDJWTPayload>(
          vpToken,
          "vc+sd-jwt",
          opts,
        );

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { iss: __iss } = result.payload;
        assert.equal(__iss, iss);
      });
    });
  });
});
