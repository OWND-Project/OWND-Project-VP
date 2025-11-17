import { assert } from "chai";
import { faker } from "@faker-js/faker";
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
import { SqlClient, initClient } from "../../src/local-data/sqlite-client.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  UrlDocument,
} from "../../src/usecases/types.js";
import {
  ClaimRepository,
  initClaimRepository,
} from "../../src/usecases/claim-repository.js";
import { Docs, setupNode } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import {
  claimHandler,
  LocalClaimHandler,
  urlHandler,
  LocalUrlHandler,
  LocalAffiliationHandler,
  affiliationHandler,
  SyncHistoryHandler,
  syncHistoryHandler,
} from "../../src/local-data/local-data-handler.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";
import { genAffiliationData } from "../fixtures/index.js";
import { syncers } from "../../src/local-data/syncer.js";
import { randomUniqueString } from "../../src/utils/random-util.js";

describe("Local-Data", () => {
  let docs: Docs | null = null;
  let sqliteClient: SqlClient;
  let repository: ClaimRepository;
  let __urlHandler: LocalUrlHandler;
  let __claimHandler: LocalClaimHandler;
  let __affiliationHandler: LocalAffiliationHandler;
  let __syncHistoryHandler: SyncHistoryHandler;
  let claimerDoc: ClaimerDocument;
  let claimerDoc2: ClaimerDocument;
  let claimerDoc3: ClaimerDocument;
  let claimerDoc4: ClaimerDocument;
  let affDoc: AffiliationDocument;

  beforeEach(async () => {
    console.log(
      "------------------------ beforeEach@Local-Data ------------------------",
    );
    const dbPath = "./test.sqlite";
    sqliteClient = await initClient(dbPath);
    await sqliteClient.destroy();
    await sqliteClient.init();

    const ipfsPath = generateTemporaryPath("ipfs", "blocks");
    const orbitdbPath = generateTemporaryPath("orbitdb");
    const keystorePath = generateTemporaryPath("keystore");

    const __syncers = await syncers(dbPath);
    const { syncUrl, syncClaim, syncAffiliation } = __syncers;
    const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
      await onUpdate({
        label: "local-data-handler",
        syncUrl,
        syncClaim,
        syncAffiliation,
      });
    __urlHandler = await urlHandler(sqliteClient.db);
    __claimHandler = await claimHandler(sqliteClient.db);
    __affiliationHandler = await affiliationHandler(sqliteClient.db);
    __syncHistoryHandler = await syncHistoryHandler(sqliteClient.db);

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
    repository = initClaimRepository(docs);

    // claimer1
    const idToken = await createIdToken();
    const sub = extractSub(idToken)!;
    claimerDoc = await repository.putClaimer({
      idToken,
      sub,
      icon: "dummy",
    });
    // claimer2
    const idToken2 = await createIdToken();
    const sub2 = extractSub(idToken)!;
    claimerDoc2 = await repository.putClaimer({
      idToken: idToken2,
      sub: sub2,
      icon: "dummy",
    });
    // claimer3
    const idToken3 = await createIdToken();
    const sub3 = extractSub(idToken)!;
    claimerDoc3 = await repository.putClaimer({
      idToken: idToken3,
      sub: sub3,
      icon: "dummy",
    });
    // claimer4
    const idToken4 = await createIdToken();
    const sub4 = extractSub(idToken)!;
    claimerDoc4 = await repository.putClaimer({
      idToken: idToken4,
      sub: sub4,
      icon: "dummy",
    });
    // affiliation
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
      "------------------------ afterEach@Local-Data ------------------------",
    );
    if (docs) {
      docs.closeDocuments;
    }
    await clearDir();
    await sqliteClient.destroy();
  });
  describe("local-data-handler", () => {
    describe("urls", () => {
      let urlDoc: UrlDocument;
      beforeEach(async () => {
        urlDoc = await repository.putUrl({
          url: faker.internet.url(),
          title: faker.string.alpha(10),
          description: faker.string.alpha(10),
          contentType: "text/html",
          image: [{ width: 0, url: faker.image.dataUri() }],
        });
        await delay(100);
      });
      describe("#getUrlsByUrlId", () => {
        it("should return 1 record", async () => {
          const localUrl = await __urlHandler.getUrlByUrlId(urlDoc.id);
          if (localUrl) {
            assert.equal(localUrl.url_id, urlDoc.id);
            assert.equal(localUrl.url, urlDoc.url);
            assert.equal(localUrl.search, urlDoc.search);
            assert.equal(localUrl.domain, urlDoc.domain);
            assert.equal(localUrl.title, urlDoc.title);
            assert.equal(localUrl.description, urlDoc.description);
            assert.equal(localUrl.content_type, urlDoc.content_type);
            assert.equal(localUrl.image, urlDoc.image);
            assert.equal(localUrl.source_created_at, urlDoc.created_at);
          } else {
            assert.fail("should have 1 record");
          }
        });
      });
      describe("#getUrlMetadata", () => {
        it("should return 0 record", async () => {
          const localUrl = await __urlHandler.getUrlMetadata("no-such-url-id");
          assert.isUndefined(localUrl);
        });
        it("should return 1 record", async () => {
          const localUrl = await __urlHandler.getUrlMetadata(urlDoc.id);
          if (localUrl) {
            assert.equal(localUrl.id, urlDoc.id);
            assert.equal(localUrl.url, urlDoc.url);
            assert.equal(localUrl.search, urlDoc.search);
            assert.equal(localUrl.domain, urlDoc.domain);
            assert.equal(localUrl.title, urlDoc.title);
            assert.equal(localUrl.description, urlDoc.description);
            assert.equal(localUrl.content_type, urlDoc.content_type);
            assert.equal(localUrl.image, urlDoc.image);
            assert.equal(localUrl.source_created_at, urlDoc.created_at);
          } else {
            assert.fail("should return 1 record");
          }
        });
      });
    });

    describe("affiliations", () => {
      let affiliationDoc: AffiliationDocument;
      beforeEach(async () => {
        // affiliation
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
        affiliationDoc = await repository.putAffiliation({
          claimer_id: claimerDoc.id,
          claimer_sub: claimerDoc.sub,
          organization,
        });
        await delay(100);
      });
      it("should return 0 record", async () => {
        const localAffiliation =
          await __affiliationHandler.getAffiliationById("no-such-id");
        if (localAffiliation) {
          assert.fail("should return 0 record");
        }
      });
      it("should return 1 record", async () => {
        const localAffiliation = await __affiliationHandler.getAffiliationById(
          affiliationDoc.id,
        );
        if (localAffiliation) {
          assert.equal(localAffiliation.affiliation_id, affiliationDoc.id);
          assert.equal(localAffiliation.claimer_id, affiliationDoc.claimer_id);
          assert.equal(
            localAffiliation.organization,
            affiliationDoc.organization,
          );
          assert.equal(
            localAffiliation.source_created_at,
            affiliationDoc.created_at,
          );
        } else {
          assert.fail("should return 1 record");
        }
      });
    });
    describe("claims", () => {
      let urlDoc: UrlDocument;
      let urlDoc2: UrlDocument;
      let urlDoc3: UrlDocument;

      const baseTime = new Date();
      const currentTime = (delta: number) => {
        return {
          currentTime: new Date(baseTime.getTime() + delta),
        };
      };
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

      const time0 = currentTime(0);
      const time1 = currentTime(10000);
      const time2 = currentTime(20000);
      const time3 = currentTime(30000);
      const time4 = currentTime(40000);
      const time5 = currentTime(50000);

      beforeEach(async () => {
        console.log(
          "------------------------ beforeEach@claims ------------------------",
        );
        // url
        urlDoc = await repository.putUrl({
          url: faker.internet.url() + "?param1=1",
          title: faker.string.alpha(10),
          description: faker.string.alpha(10),
          contentType: "text/html",
          image: [{ width: 0, url: faker.image.dataUri() }],
        });
        urlDoc2 = await repository.putUrl({
          url: faker.internet.url(),
          title: faker.string.alpha(10),
          description: faker.string.alpha(10),
          contentType: "text/html",
          image: [{ width: 0, url: faker.image.dataUri() }],
        });
        urlDoc3 = await repository.putUrl({
          url: faker.internet.url(),
          title: faker.string.alpha(10),
          description: faker.string.alpha(10),
          contentType: "text/html",
          image: [{ width: 0, url: faker.image.dataUri() }],
        });
      });
      describe("get", () => {
        let claimDoc: ClaimDocument;
        let claimDoc2: ClaimDocument;
        let claimDoc3: ClaimDocument;
        let claimDoc4: ClaimDocument;
        let claimDoc5: ClaimDocument;
        describe("#getAggregatedUrl", () => {
          describe("without option", () => {
            describe("exists 3 claims under 1 url", () => {
              /*
                  - url1
                    - claim1
                    - claim2
                    - claim3
                    - claim4(deleted)
               */
              beforeEach(async () => {
                // 1
                claimDoc = await repository.putClaim(
                  toPayload(await genClaim(0), urlDoc, claimerDoc, affDoc),
                  time0,
                );
                // 2
                claimDoc2 = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc2),
                  time1,
                );
                // 3
                claimDoc3 = await repository.putClaim(
                  toPayload(await genClaim(2), urlDoc, claimerDoc3),
                  time2,
                );
                // 4
                claimDoc4 = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc4),
                  time2,
                );
                await repository.deleteClaim(claimDoc4); // delete claim
                await delay(500);
              });
              it("should return 1 record", async () => {
                const localClaims = await __claimHandler.getAggregatedUrl();
                if (localClaims) {
                  assert.equal(localClaims[0].id, urlDoc.id);
                  assert.equal(localClaims[0].url, urlDoc.url);
                  assert.equal(localClaims[0].true_count, 1);
                  assert.equal(localClaims[0].false_count, 1);
                  assert.equal(localClaims[0].else_count, 1);
                  assert.equal(localClaims[0].verified_true_count, 0);
                  assert.equal(localClaims[0].verified_false_count, 1);
                  assert.equal(localClaims[0].verified_else_count, 0);
                  assert.equal(
                    localClaims[0].oldest_created_at,
                    claimDoc.created_at,
                  );
                } else {
                  assert.fail("should have 1 record");
                }
              });
            });
            describe("exists 3 claims under 2 urls", () => {
              /*
                  - url1
                    - claim1
                    - claim2
                  - url2
                    - claim3
               */
              beforeEach(async () => {
                // 1
                claimDoc = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc, affDoc),
                );
                // 2
                claimDoc2 = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc2),
                );
                // 3
                claimDoc3 = await repository.putClaim(
                  toPayload(await genClaim(0), urlDoc2, claimerDoc3),
                );
                await delay(500);
              });
              it("should return 2 record", async () => {
                const localClaims = await __claimHandler.getAggregatedUrl();
                if (localClaims) {
                  assert.equal(localClaims[0].id, urlDoc2.id);
                  assert.equal(localClaims[0].url, urlDoc2.url);
                  assert.equal(localClaims[0].true_count, 0);
                  assert.equal(localClaims[0].false_count, 1);
                  assert.equal(localClaims[0].else_count, 0);
                  assert.equal(localClaims[0].verified_true_count, 0);
                  assert.equal(localClaims[0].verified_false_count, 0);
                  assert.equal(localClaims[0].verified_false_count, 0);
                  assert.equal(
                    localClaims[0].oldest_created_at,
                    claimDoc3.created_at,
                  );

                  assert.equal(localClaims[1].id, urlDoc.id);
                  assert.equal(localClaims[1].url, urlDoc.url);
                  assert.equal(localClaims[1].true_count, 2);
                  assert.equal(localClaims[1].false_count, 0);
                  assert.equal(localClaims[1].else_count, 0);
                  assert.equal(localClaims[1].verified_true_count, 1);
                  assert.equal(localClaims[1].verified_false_count, 0);
                  assert.equal(localClaims[1].verified_false_count, 0);
                  assert.equal(
                    localClaims[1].oldest_created_at,
                    claimDoc.created_at,
                  );
                } else {
                  assert.fail("should have 2 records");
                }
              });
            });
          });
          describe("with option", () => {
            describe("filter", () => {
              /*
                  - url1
                    - claim1 (claimer1)
                    - claim2 (claimer2)
                    - claim4 (claimer3) the latest claim
                  - url2
                    - claim3 (claimer1)
               */
              beforeEach(async () => {
                console.log(
                  "------------------------ beforeEach@with option ------------------------",
                );
                // 1
                claimDoc = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc),
                  time0,
                );
                // 2
                claimDoc2 = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc2),
                  time1,
                );
                // 3
                claimDoc3 = await repository.putClaim(
                  toPayload(await genClaim(0), urlDoc2, claimerDoc),
                  time2,
                );
                // 4
                claimDoc4 = await repository.putClaim(
                  toPayload(await genClaim(2), urlDoc, claimerDoc3),
                  time3,
                );

                await delay(500);
              });
              describe("filter by url", () => {
                it("should return 1 record", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    filter: urlDoc.url,
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 1);
                    assert.equal(localClaims[0].id, urlDoc.id);
                    assert.equal(localClaims[0].url, urlDoc.url);
                    assert.equal(localClaims[0].true_count, 2);
                    assert.equal(localClaims[0].false_count, 0);
                    assert.equal(localClaims[0].else_count, 1);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 1 record");
                  }
                });
              });
              describe("filter by start date", () => {
                it("should return 2 records", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    startDate: new Date(claimDoc.created_at),
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 2);
                    // 1
                    assert.equal(localClaims[0].id, urlDoc2.id);
                    assert.equal(localClaims[0].url, urlDoc2.url);
                    assert.equal(localClaims[0].true_count, 0);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc3.created_at,
                    );
                    // 2
                    assert.equal(localClaims[1].id, urlDoc.id);
                    assert.equal(localClaims[1].url, urlDoc.url);
                    assert.equal(localClaims[1].true_count, 2);
                    assert.equal(localClaims[1].false_count, 0);
                    assert.equal(localClaims[1].else_count, 1);
                    assert.equal(
                      localClaims[1].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 2 records");
                  }
                });
                it("should return 1 record (case 1)", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    startDate: new Date(claimDoc3.created_at),
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 1);
                    // 1
                    assert.equal(localClaims[0].id, urlDoc2.id);
                    assert.equal(localClaims[0].url, urlDoc2.url);
                    assert.equal(localClaims[0].true_count, 0);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc3.created_at,
                    );
                  } else {
                    assert.fail("should have 1 record");
                  }
                });
              });
              describe("filter by url and start date", () => {
                it("should return 0 record", async () => {
                  const laterThanOldestClaimUnderUrl1 =
                    new Date(claimDoc.created_at).getTime() + 1000;
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    filter: urlDoc.url,
                    startDate: new Date(laterThanOldestClaimUnderUrl1),
                  });
                  if (!localClaims) {
                    assert.fail("should not be undefined");
                  } else if (0 < localClaims.length) {
                    assert.fail("should be empty");
                  }
                });
                it("should return 1 record", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    filter: urlDoc.url,
                    startDate: new Date(claimDoc.created_at),
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 1);
                    assert.equal(localClaims[0].id, urlDoc.id);
                    assert.equal(localClaims[0].url, urlDoc.url);
                    assert.equal(localClaims[0].true_count, 2);
                    assert.equal(localClaims[0].false_count, 0);
                    assert.equal(localClaims[0].else_count, 1);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 1 record");
                  }
                });
              });
            });
            describe("filter and sort", () => {
              /*
                  - url1
                    - claim1 (time1, claimer1)
                    - claim2 (time2, claimer2)
                    - claim3 (time4, claimer3)
                  - url2
                    - claim4 (time0, claimer1) the oldest one
                  - url3
                    - claim5 (time3, claimer1)
               */
              beforeEach(async () => {
                console.log(
                  "------------------------ beforeEach@with option ------------------------",
                );
                const currentTime = new Date().toISOString();
                const affDoc = {
                  id: randomUniqueString(),
                  claimer_id: "",
                  claimer_sub: "",
                  organization: "",
                  created_at: currentTime,
                };
                // 1
                claimDoc = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc, affDoc),
                  time1,
                );
                // 2
                claimDoc2 = await repository.putClaim(
                  toPayload(await genClaim(1), urlDoc, claimerDoc2, affDoc),
                  time2,
                );
                // 3
                claimDoc3 = await repository.putClaim(
                  toPayload(await genClaim(2), urlDoc, claimerDoc3, affDoc),
                  time4,
                );
                // 4
                claimDoc4 = await repository.putClaim(
                  toPayload(await genClaim(2), urlDoc2, claimerDoc, affDoc),
                  time0,
                );
                // 5
                claimDoc5 = await repository.putClaim(
                  toPayload(await genClaim(0), urlDoc3, claimerDoc, affDoc),
                  time3,
                );

                await delay(500);
              });
              describe("filter by start date and sort by true_count", () => {
                it("should return 2 records", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    startDate: new Date(claimDoc.created_at),
                    sortKey: "true_count",
                    desc: true,
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 2);
                    // 1
                    assert.equal(localClaims[0].id, urlDoc.id);
                    assert.equal(localClaims[0].url, urlDoc.url);
                    assert.equal(localClaims[0].true_count, 2);
                    assert.equal(localClaims[0].false_count, 0);
                    assert.equal(localClaims[0].else_count, 1);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc.created_at,
                    );
                    // 2
                    assert.equal(localClaims[1].id, urlDoc3.id);
                    assert.equal(localClaims[1].url, urlDoc3.url);
                    assert.equal(localClaims[1].true_count, 0);
                    assert.equal(localClaims[1].false_count, 1);
                    assert.equal(localClaims[1].else_count, 0);
                    assert.equal(
                      localClaims[1].oldest_created_at,
                      claimDoc5.created_at,
                    );
                  } else {
                    assert.fail("should have 2 records");
                  }
                });
              });
              describe("filter by start date and sort by false", () => {
                it("should return 2 records", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    startDate: new Date(claimDoc.created_at),
                    sortKey: "false_count",
                    desc: true,
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 2);
                    // 1
                    assert.equal(localClaims[0].id, urlDoc3.id);
                    assert.equal(localClaims[0].url, urlDoc3.url);
                    assert.equal(localClaims[0].true_count, 0);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc5.created_at,
                    );
                    // 2
                    assert.equal(localClaims[1].id, urlDoc.id);
                    assert.equal(localClaims[1].url, urlDoc.url);
                    assert.equal(localClaims[1].true_count, 2);
                    assert.equal(localClaims[1].false_count, 0);
                    assert.equal(localClaims[1].else_count, 1);
                    assert.equal(
                      localClaims[1].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 2 records");
                  }
                });
              });
              describe("sort by start date", () => {
                it("should return 3 records", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    sortKey: "created_at",
                    desc: true,
                  });
                  if (localClaims) {
                    assert.equal(localClaims.length, 3);
                    // 1
                    assert.equal(localClaims[0].id, urlDoc3.id);
                    assert.equal(localClaims[0].url, urlDoc3.url);
                    assert.equal(localClaims[0].true_count, 0);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc5.created_at,
                    );
                    // 2
                    assert.equal(localClaims[1].id, urlDoc.id);
                    assert.equal(localClaims[1].url, urlDoc.url);
                    assert.equal(localClaims[1].true_count, 2);
                    assert.equal(localClaims[1].false_count, 0);
                    assert.equal(localClaims[1].else_count, 1);
                    assert.equal(
                      localClaims[1].oldest_created_at,
                      claimDoc.created_at,
                    );
                    // 3
                    assert.equal(localClaims[2].id, urlDoc2.id);
                    assert.equal(localClaims[2].url, urlDoc2.url);
                    assert.equal(localClaims[2].true_count, 0);
                    assert.equal(localClaims[2].false_count, 0);
                    assert.equal(localClaims[2].else_count, 1);
                    assert.equal(
                      localClaims[2].oldest_created_at,
                      claimDoc4.created_at,
                    );
                  } else {
                    assert.fail("should have 2 records");
                  }
                });
              });
            });
          });
          describe("duplicated url", () => {
            /*
                - url1
                  - claim1
                  - claim2
                - url2
                  - claim3
             */
            beforeEach(async () => {
              const sameUrl = await repository.putUrl({
                url: urlDoc.url,
                title: urlDoc.title,
                description: urlDoc.description,
                contentType: urlDoc.content_type!,
                image: [{ width: 0, url: faker.image.dataUri() }],
              });
              // 1
              claimDoc = await repository.putClaim(
                toPayload(await genClaim(1), urlDoc, claimerDoc, affDoc),
              );
              // 2
              claimDoc2 = await repository.putClaim(
                toPayload(await genClaim(1), urlDoc, claimerDoc2),
              );
              // 3
              claimDoc3 = await repository.putClaim(
                toPayload(await genClaim(0), sameUrl, claimerDoc3),
              );
              await delay(500);
            });
            describe("exists 3 claims under 2 urls(these have the same url and different id's)", () => {
              describe("without option", () => {
                it("should return 1 record", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl();
                  if (localClaims) {
                    assert.equal(localClaims[0].id, urlDoc.id);
                    assert.equal(localClaims[0].url, urlDoc.url);
                    assert.equal(localClaims[0].true_count, 2);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(localClaims[0].verified_true_count, 1);
                    assert.equal(localClaims[0].verified_false_count, 0);
                    assert.equal(localClaims[0].verified_false_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 1 record");
                  }
                });
              });
              describe("with option", () => {
                it("should return 1 record", async () => {
                  const localClaims = await __claimHandler.getAggregatedUrl({
                    filter: urlDoc.url,
                  });
                  if (localClaims) {
                    assert.equal(localClaims[0].id, urlDoc.id);
                    assert.equal(localClaims[0].url, urlDoc.url);
                    assert.equal(localClaims[0].true_count, 2);
                    assert.equal(localClaims[0].false_count, 1);
                    assert.equal(localClaims[0].else_count, 0);
                    assert.equal(localClaims[0].verified_true_count, 1);
                    assert.equal(localClaims[0].verified_false_count, 0);
                    assert.equal(localClaims[0].verified_false_count, 0);
                    assert.equal(
                      localClaims[0].oldest_created_at,
                      claimDoc.created_at,
                    );
                  } else {
                    assert.fail("should have 1 record");
                  }
                });
              });
            });
          });
        });
        describe("#getAggregatedUrlByUrl", () => {
          /*
              - url1
                - claim1
                - claim2
              - url2
                - claim3
           */
          beforeEach(async () => {
            claimDoc = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 1 })),
              urlDoc,
              claimerDoc,
            });
            claimDoc2 = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 1 })),
              urlDoc,
              claimerDoc: claimerDoc2,
            });
            claimDoc3 = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 0 })),
              urlDoc: urlDoc2,
              claimerDoc: claimerDoc3,
            });
            await delay(500);
          });
          it("should return 1 record", async () => {
            const localClaim = await __claimHandler.getAggregatedUrlByUrl(
              urlDoc.url,
            );
            if (localClaim) {
              assert.equal(localClaim.id, urlDoc.id);
              assert.equal(localClaim.url, urlDoc.url);
              assert.equal(localClaim.true_count, 2);
              assert.equal(localClaim.false_count, 0);
              assert.equal(localClaim.else_count, 0);
              assert.equal(localClaim.oldest_created_at, claimDoc.created_at);
            } else {
              assert.fail("should have 1 record");
            }
          });
        });
        describe("#getClaimsByClaimer", () => {
          /*
              - url1
                - claim1 (claimer 1)
                - claim2 (claimer 2)
              - url2
                - claim3 (claimer 1)
           */
          beforeEach(async () => {
            claimDoc = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 1 })),
              urlDoc,
              claimerDoc,
            });
            claimDoc2 = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 1 })),
              urlDoc,
              claimerDoc: claimerDoc2,
            });
            claimDoc3 = await repository.putClaim({
              comment: await getClaimJwt(createClaimPayload({ boolValue: 0 })),
              urlDoc: urlDoc2,
              claimerDoc: claimerDoc,
            });
            await delay(500);
          });
          it("should be added 2 records", async () => {
            const localClaims = await __claimHandler.getClaimsByClaimer(
              claimerDoc.id,
            );
            if (localClaims) {
              assert.equal(localClaims.length, 2);
              // 1
              assert.equal(localClaims[0].claim_id, claimDoc3.id);
              assert.equal(localClaims[0].url, urlDoc2.url);
              assert.equal(localClaims[0].comment, claimDoc3.comment);
              assert.equal(localClaims[0].bool_value, 0);
              assert.equal(localClaims[0].claimer_id, claimerDoc.id);
              assert.equal(
                localClaims[0].source_created_at,
                claimDoc3.created_at,
              );
              // 2
              assert.equal(localClaims[1].claim_id, claimDoc.id);
              assert.equal(localClaims[1].url, urlDoc.url);
              assert.equal(localClaims[1].comment, claimDoc.comment);
              assert.equal(localClaims[1].bool_value, 1);
              assert.equal(localClaims[1].claimer_id, claimerDoc.id);
              assert.equal(
                localClaims[1].source_created_at,
                claimDoc.created_at,
              );
            } else {
              assert.fail("should have 2 records");
            }
          });
        });
      });
    });
    describe("sync_histories", () => {
      const hash1 = "dummy hash1";
      const hash2 = "dummy hash2";
      const key1 = "dummy key1";
      const key2 = "dummy key2";
      beforeEach(async () => {
        console.log(
          "------------------------ beforeEach@sync_histories ------------------------",
        );
        await __syncHistoryHandler.addSyncHistory("urls", hash1, key1);
        await delay(1000);
        await __syncHistoryHandler.addSyncHistory("urls", hash2, key2);
      });
      describe("#getLatestSyncHistory", () => {
        it("should return nothing ", async () => {
          const row =
            await __syncHistoryHandler.getLatestSyncHistory("no-such-doc-type");
          if (row) {
            assert.fail("should return nothing");
          }
        });
        it("should return latest row ", async () => {
          const row = await __syncHistoryHandler.getLatestSyncHistory("urls");
          if (row) {
            assert.equal(row.doc_type, "urls");
            assert.equal(row.hash, hash2);
            assert.equal(row.key, key2);
          } else {
            assert.fail("should return 1 record");
          }
        });
      });
    });
  });
});
