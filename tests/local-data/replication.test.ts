import { initClient, SqlClient } from "../../src/local-data/sqlite-client.js";
import {
  clearDir,
  createClaimPayload,
  createIdToken,
  createKeyPair,
  createSdJwt,
  delay,
  extractSub,
  generateTemporaryPath,
  getClaimJwt,
} from "../test-utils.js";
import { Syncers, syncers } from "../../src/local-data/syncer.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { Docs, setupNode } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import {
  ClaimRepository,
  initClaimRepository,
} from "../../src/usecases/claim-repository.js";
import { faker } from "@faker-js/faker";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  UrlDocument,
} from "../../src/usecases/types.js";
import { assert } from "chai";
import { replication } from "../../src/local-data/replication.js";
import { genAffiliationData } from "../fixtures/index.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";

describe("Replication", () => {
  let docs: Docs | null = null;
  let sqliteClient: SqlClient;
  let repository: ClaimRepository;
  let __syncers: Syncers;
  let resetOnUpdateState: () => void;
  let urlDoc: UrlDocument;
  let claimerDoc: ClaimerDocument;
  let affDoc: AffiliationDocument;

  beforeEach(async () => {
    console.log(
      "------------------------ beforeEach@Replication ------------------------",
    );
    const dbPath = "./test.replication.sqlite";
    sqliteClient = await initClient(dbPath);
    await sqliteClient.destroy();
    await sqliteClient.init();

    const ipfsPath = generateTemporaryPath("ipfs", "blocks");
    const orbitdbPath = generateTemporaryPath("orbitdb");
    const keystorePath = generateTemporaryPath("keystore");

    __syncers = await syncers(dbPath);
    const { syncUrl, syncClaim, syncAffiliation } = __syncers;
    const __replication = replication(__syncers);
    const { setDocs, syncAllUrls, syncAllClaims, syncAllAffiliations } =
      __replication;
    const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations, resetState } =
      await onUpdate({
        label: "local-data-handler",
        syncUrl,
        syncClaim,
        syncAffiliation,
        syncAllUrls,
        syncAllClaims,
        syncAllAffiliations,
      });
    resetOnUpdateState = resetState;
    const node = await setupNode(getLibp2pOptions(), {
      ipfsPath,
      orbitdbPath,
      keystorePath,
      identityKey: "main_peer",
    });
    const DocType = {
      urls: { name: "urls", indexBy: "id", onUpdate: onUpdateUrls },
      claimers: { name: "claimers", indexBy: "id" },
      claims: {
        name: "claims",
        indexBy: "id",
        onUpdate: onUpdateClaims,
      },
      affiliates: {
        name: "affiliations",
        indexBy: "id",
        onUpdate: onUpdateAffiliations,
      },
    };
    docs = await node.openDocuments([
      DocType.urls,
      DocType.claimers,
      DocType.claims,
      DocType.affiliates,
    ]);
    setDocs(docs);
    repository = initClaimRepository(docs);

    // common url document
    urlDoc = await repository.putUrl({
      url: faker.internet.url(),
      title: faker.string.alpha(10),
      description: faker.string.alpha(10),
      contentType: "text/html",
      image: [{ width: 0, url: faker.image.dataUri() }],
    });
    // common claimer
    const idToken = await createIdToken();
    const sub = extractSub(idToken)!;
    claimerDoc = await repository.putClaimer({
      idToken,
      sub,
      icon: "dummy",
    });
    // common affiliation
    const { claims, disClosureFrame } = genAffiliationData();
    const holderKeyPair = createKeyPair();
    const affiliation = await createSdJwt(claims, disClosureFrame, {
      holderPublicJwk: holderKeyPair,
    });
    const kbJwt = await issueJwt(
      { alg: "ES256" },
      { nonce: "dummy-nonce" },
      holderKeyPair,
    );
    const organization = affiliation + kbJwt;
    affDoc = await repository.putAffiliation({
      claimer_id: claimerDoc.id,
      claimer_sub: claimerDoc.sub,
      organization,
    });
  });
  afterEach(async () => {
    console.log(
      "------------------------ afterEach@Replication ------------------------",
    );
    if (docs) {
      docs.closeDocuments;
    }
    await clearDir();
    await sqliteClient.destroy();
  });
  describe("urls", () => {
    it("should be added 1 record", async () => {
      await delay(100);
      const his = await __syncers.latestHistory("urls");
      if (his) {
        const { key } = his;
        assert.equal(key, urlDoc.id);

        resetOnUpdateState();

        await delay(1000);
        const urlDoc2 = await repository.putUrl({
          url: faker.internet.url(),
          title: faker.string.alpha(10),
          description: faker.string.alpha(10),
          contentType: "text/html",
          image: [{ width: 0, url: faker.image.dataUri() }],
        });
        await delay(100);

        const his2 = await __syncers.latestHistory("urls");
        if (his2) {
          const { key } = his2;
          assert.equal(key, urlDoc2.id);
        } else {
          assert.fail("should have 1 record");
        }
      } else {
        assert.fail("should have 1 record");
      }
    });
  });
  describe("claims", () => {
    let claimDoc: ClaimDocument;
    const genClaim = async (boolValue: number) => {
      return await getClaimJwt(createClaimPayload({ boolValue }));
    };
    const toPayload = (
      comment: string,
      urlDoc: UrlDocument,
      claimerDoc: ClaimerDocument,
      affiliationDoc?: AffiliationDocument,
    ) => {
      return {
        comment,
        urlDoc,
        claimerDoc,
        affiliationDoc,
      };
    };
    beforeEach(async () => {
      claimDoc = await repository.putClaim(
        toPayload(await genClaim(0), urlDoc, claimerDoc, affDoc),
      );
    });
    it("should be added 1 record", async () => {
      await delay(100);
      const his = await __syncers.latestHistory("claims");
      if (his) {
        const { key } = his;
        assert.equal(key, claimDoc.id);

        resetOnUpdateState();

        await delay(1000);
        const claimDoc2 = await repository.putClaim(
          toPayload(await genClaim(0), urlDoc, claimerDoc, affDoc),
        );
        await delay(100);

        const his2 = await __syncers.latestHistory("claims");
        if (his2) {
          const { key } = his2;
          assert.equal(key, claimDoc2.id);
        } else {
          assert.fail("should have 1 record");
        }
      } else {
        assert.fail("should have 1 record");
      }
    });
  });
  describe("affiliations", () => {
    it("should be added 1 record", async () => {
      await delay(100);
      const his = await __syncers.latestHistory("affiliations");
      if (his) {
        const { key } = his;
        assert.equal(key, affDoc.id);

        resetOnUpdateState();

        await delay(1000);
        const { claims, disClosureFrame } = genAffiliationData();
        const holderKeyPair = createKeyPair();
        const affiliation = await createSdJwt(claims, disClosureFrame, {
          holderPublicJwk: holderKeyPair,
        });
        const kbJwt = await issueJwt(
          { alg: "ES256" },
          { nonce: "dummy-nonce" },
          holderKeyPair,
        );
        const organization = affiliation + kbJwt;
        const affDoc2 = await repository.putAffiliation({
          claimer_id: claimerDoc.id,
          claimer_sub: claimerDoc.sub,
          organization,
        });
        await delay(100);

        const his2 = await __syncers.latestHistory("affiliations");
        if (his2) {
          const { key } = his2;
          assert.equal(key, affDoc2.id);
        } else {
          assert.fail("should have 1 record");
        }
      } else {
        assert.fail("should have 1 record");
      }
    });
  });
});
