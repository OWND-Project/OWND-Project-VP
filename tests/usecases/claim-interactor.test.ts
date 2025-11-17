import path from "path";
import { assert } from "chai";
import { LevelBlockstore } from "blockstore-level";

import { setupNode } from "../../src/orbit-db/index.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import { initClaimInteractor } from "../../src/usecases/claim-interactor.js";
import {
  clearDir,
  createClaim,
  createClaimer,
  createUrl,
  generateTemporaryPath,
  getClaimJwt,
  createClaimPayload,
  createIdToken,
  createSdJwt,
  createAffiliation,
  extractSub,
  delay,
} from "./../test-utils.js";
import { getDocType } from "../../src/api.js";
import { currentTime } from "../../src/helpers/jwt-helper.js";
import {
  DecodeOk,
  extractClaimerSub,
} from "../../src/usecases/internal/internal-helpers.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  ClaimerPresenter,
  ClaimPresenter,
  NewClaimPresenter,
  UrlDocument,
  UrlPresenter,
} from "../../src/usecases/types.js";
import { initMockAgent, mockHtml } from "../helpers/mock-request.js";
import { faker } from "@faker-js/faker";
import { UrlHandler } from "../../src/usecases/internal/select-url.js";
import { Docs, OpenedDocument } from "../../src/orbit-db/index.js";
import {
  ClaimRepository,
  initClaimRepository,
} from "../../src/usecases/claim-repository.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { initClient, SqlClient } from "../../src/local-data/sqlite-client.js";
import { AggregatedUrl } from "../../src/local-data/local-data-handler.js";
import { syncers } from "../../src/local-data/syncer.js";

const getPayload = (boolValue: number) => {
  return createClaimPayload({ boolValue });
};

const urlPresenter = (url: AggregatedUrl) => {
  return url;
};

describe("Usecase", () => {
  let openResult: Docs | null = null;
  let sqliteClient: SqlClient;
  let urlDocuments: OpenedDocument;
  let claimerDocuments: OpenedDocument;
  let claimDocuments: OpenedDocument;
  let affiliationDocuments: OpenedDocument;
  let interactor: ReturnType<typeof initClaimInteractor>;
  let repository: ClaimRepository;

  const dt = new Date();
  const dt2 = new Date(dt.getTime() + 1000);
  const dt3 = new Date(dt.getTime() + 2000);
  const dt4 = new Date(dt.getTime() + 3000);
  const newUrl = createUrl({ created_at: dt.toISOString() });
  const newUrl2 = createUrl({ created_at: dt2.toISOString() });
  const newUrl3 = createUrl();
  let newClaimer: ClaimerDocument;
  let newClaimer2: ClaimerDocument;
  let newAffiliation: AffiliationDocument;
  let newAffiliation2: AffiliationDocument;

  let ipfsPath;
  let orbitdbPath: string;
  let keystorePath;
  beforeEach(async () => {
    console.log(
      "------------------------ before@Usecase ------------------------",
    );
    await clearDir();

    ipfsPath = generateTemporaryPath("ipfs", "blocks");
    orbitdbPath = generateTemporaryPath("orbitdb");
    keystorePath = generateTemporaryPath("keystore");

    const node = await setupNode(getLibp2pOptions(), {
      ipfsPath,
      orbitdbPath,
      keystorePath,
      identityKey: "main_peer",
    });
    const dbPath = "./test.sqlite";
    sqliteClient = await initClient(dbPath);
    await sqliteClient.destroy();
    await sqliteClient.init();
    const db = sqliteClient.db;
    const __syncers = await syncers(dbPath);
    const { syncUrl, syncClaim, syncAffiliation } = __syncers;
    const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
      await onUpdate({
        label: "Test",
        syncUrl,
        syncClaim,
        syncAffiliation,
      });
    const docTypes = getDocType({
      onUpdateUrls,
      onUpdateClaims,
      onUpdateAffiliations,
    });
    openResult = await node.openDocuments([
      docTypes.urls,
      docTypes.claimers,
      docTypes.claims,
      docTypes.affiliates,
    ]);

    urlDocuments = openResult.documents["urls"];
    claimerDocuments = openResult.documents["claimers"];
    claimDocuments = openResult.documents["claims"];
    affiliationDocuments = openResult.documents["affiliations"];
    interactor = initClaimInteractor(openResult, db);
    repository = initClaimRepository(openResult!);

    // claimer1
    const idToken = await createIdToken();
    const sub = (extractClaimerSub(idToken) as DecodeOk).value;
    newClaimer = createClaimer({ id_token: idToken, sub });
    await claimerDocuments.document.put<ClaimerDocument>(newClaimer);

    const affiliationJwt = await createSdJwt({}, []);
    newAffiliation = createAffiliation({
      claimer_id: newClaimer.id,
      claimer_sub: sub,
      organization: affiliationJwt,
    });
    await affiliationDocuments.document.put<AffiliationDocument>(
      newAffiliation,
    );

    // claimer2
    const idToken2 = await createIdToken();
    const sub2 = (extractClaimerSub(idToken2) as DecodeOk).value;
    newClaimer2 = createClaimer({ id_token: idToken2, sub: sub2 });
    await claimerDocuments.document.put<ClaimerDocument>(newClaimer2);

    const affiliationJwt2 = await createSdJwt({}, []);
    newAffiliation2 = createAffiliation({
      claimer_id: newClaimer2.id,
      claimer_sub: sub2,
      organization: affiliationJwt2,
    });
    await affiliationDocuments.document.put<AffiliationDocument>(
      newAffiliation2,
    );
  });

  afterEach(async () => {
    console.log(
      "------------------------ afterEach@Usecase ------------------------",
    );
    console.log(orbitdbPath);
    const orbitdbIndexPath = path.join(orbitdbPath, "/log/_heads/");
    console.log(orbitdbIndexPath);
    const store = new LevelBlockstore(orbitdbIndexPath);
    for await (const pair of store.getAll()) {
      console.log(pair);
    }
    if (openResult) {
      openResult.closeDocuments;
    }
    await clearDir();
    await sqliteClient.destroy();
  });

  describe("#putUrl", () => {
    const newUrl = "https://new-example.com";
    let mockAgent: ReturnType<typeof initMockAgent>;
    const presenter: UrlPresenter<{ urlDoc: UrlDocument }> = (urlDoc) => {
      return { urlDoc };
    };
    describe("ng cases", () => {
      beforeEach(async () => {
        mockAgent = initMockAgent();
        mockAgent.getAccess(newUrl, "/", mockHtml, {
          statusCode: 200,
          headers: { "content-type": "text/html" },
        });
        const urlHandler = UrlHandler(openResult!, sqliteClient.db);
        await urlHandler.newUrl(newUrl); // for conflict test
      });
      afterEach(async () => {
        await mockAgent.close();
      });
      it("should return conflict error", async () => {
        // execute
        const result = await interactor.putUrl(newUrl, presenter);

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        assert.equal(result.error.type, "CONFLICT");
      });
      it("should return not found error", async () => {
        // prepare
        mockAgent.getAccess(newUrl, "/foo", "Not Found", { statusCode: 404 });

        // execute
        const result = await interactor.putUrl(`${newUrl}/foo`, presenter);

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        assert.equal(result.error.type, "NOT_FOUND");
      });
      it("should return client error -> return with no error(spec was changed)", async () => {
        // prepare
        mockAgent.getAccess(newUrl, "/foo", "Bad Request", { statusCode: 400 });

        // execute
        const result = await interactor.putUrl(`${newUrl}/foo`, presenter);

        // assert
        if (result.ok) {
          const { urlDoc } = result.payload;
          assert.equal(urlDoc.title, "");
          // assert.fail("should be ng");
        } else {
          assert.fail("should be ng");
        }
        // assert.equal(result.error.type, "INVALID_PARAMETER");
      });
      it("should return server error", async () => {
        // prepare
        mockAgent.getAccess(newUrl, "/foo", "Internal Server Error", {
          statusCode: 500,
        });

        // execute
        const result = await interactor.putUrl(`${newUrl}/foo`, presenter);

        // assert
        if (result.ok) {
          assert.fail("should be ng");
        }
        assert.equal(result.error.type, "UNEXPECTED_ERROR");
      });
    });
    describe("ok cases", () => {
      it("should return new url", async () => {
        // prepare
        mockAgent = initMockAgent();
        mockAgent.getAccess(newUrl, "/", mockHtml, {
          statusCode: 200,
          headers: { "content-type": "text/html" },
        });

        // execute
        const result = await interactor.putUrl(newUrl, presenter);

        // assert
        if (!result.ok) {
          assert.fail("should be ok");
        }
        const { urlDoc } = result.payload;
        assert.equal(urlDoc.url, newUrl);
        assert.equal(urlDoc.title, "Open Graph protocol");
        await mockAgent.close();
      });
    });
  });
  describe("#getUrls", () => {
    describe("no options", () => {
      beforeEach(async () => {
        await urlDocuments.document.put<UrlDocument>(newUrl);

        const claimJwt = await getClaimJwt(getPayload(1));
        const newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          comment: claimJwt,
          affiliation_id: newAffiliation.id,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);

        await delay(100);
      });
      describe("1 record", () => {
        it("should return 1 url", async () => {
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            {},
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 1);
          const url = urls[0];
          assert.equal(url.id, newUrl.id);
          assert.equal(url.true_count, 1);
          assert.equal(url.false_count, 0);
          assert.equal(url.else_count, 0);
          assert.equal(url.verified_true_count, 1);
          assert.equal(url.verified_false_count, 0);
          assert.equal(url.verified_else_count, 0);
        });
      });
      describe("2 records", () => {
        beforeEach(async () => {
          await urlDocuments.document.put<UrlDocument>(newUrl2);

          const claimJwt2 = await getClaimJwt(getPayload(0));
          const newClaim2 = createClaim({
            url: newUrl2.url,
            claimer_id: newClaimer.id,
            comment: claimJwt2,
            affiliation_id: newAffiliation.id,
            created_at: dt2.toISOString(),
          });
          await claimDocuments.document.put<ClaimDocument>(newClaim2);

          await delay(100);
        });
        it("should return 2 urls", async () => {
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            {},
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 2);
          const url = urls[0];
          assert.equal(url.id, newUrl2.id);
          assert.equal(url.true_count, 0);
          assert.equal(url.false_count, 1);
          assert.equal(url.else_count, 0);
          assert.equal(url.verified_true_count, 0);
          assert.equal(url.verified_false_count, 1);
          assert.equal(url.verified_else_count, 0);

          const url2 = urls[1];
          assert.equal(url2.id, newUrl.id);
          assert.equal(url2.true_count, 1);
          assert.equal(url2.false_count, 0);
          assert.equal(url2.else_count, 0);
          assert.equal(url2.verified_true_count, 1);
          assert.equal(url2.verified_false_count, 0);
          assert.equal(url2.verified_else_count, 0);
        });
      });
    });

    describe("with options", () => {
      /*
          /url1
            claim1
          /url2
            claim2
          /url3
       */
      let newUrl: UrlDocument;
      let newUrl2: UrlDocument;
      let newUrl3: UrlDocument;
      beforeEach(async () => {
        // generate test data
        newUrl = createUrl({
          url: "https://foo.com",
        });
        await urlDocuments.document.put<UrlDocument>(newUrl);
        newUrl2 = createUrl({
          url: "https://bar.com",
        });
        await urlDocuments.document.put<UrlDocument>(newUrl2);
        newUrl3 = createUrl({
          url: "https://baz.com",
        });
        await urlDocuments.document.put<UrlDocument>(newUrl3);

        const claimJwt = await getClaimJwt(getPayload(1));
        const newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          comment: claimJwt,
          affiliation_id: newAffiliation.id,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);
        const claimJwt2 = await getClaimJwt(getPayload(0));
        const newClaim2 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          comment: claimJwt2,
          affiliation_id: newAffiliation.id,
          created_at: dt2.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim2);

        await delay(100);
      });
      describe("filter", () => {
        it("should return 1 urls (foo.com)", async () => {
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            { filter: "foo.com" },
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 1);
          const url = urls[0];
          assert.equal(url.id, newUrl.id);
        });
        it("should return 0 urls (baz.com which has no claims)", async () => {
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            { filter: "baz.com" },
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 0);
        });
      });
      describe("filter and start date", () => {
        it("should return 0 urls (foo.com but before start date)", async () => {
          const startDate = new Date(dt.getTime() + 1000);
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            { filter: "foo.com", startDate },
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 0);
        });
        it("should return 1 urls (foo.com and after start date)", async () => {
          const startDate = new Date(dt.getTime() - 1000);
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            { filter: "foo.com", startDate },
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 1);
        });
        it("should return 0 urls (after start date but not match filter)", async () => {
          const startDate = new Date(dt.getTime() - 1000);
          // execute
          const urls = await interactor.getUrls<AggregatedUrl>(
            { filter: "xxx", startDate },
            urlPresenter,
          );

          // assert
          assert.equal(urls.length, 0);
        });
      });
    });
  });
  describe("#getUrl", () => {
    beforeEach(async () => {
      // url
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      // claim1
      const claimJwt = await getClaimJwt(getPayload(1));
      const newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        comment: claimJwt,
        affiliation_id: newAffiliation.id,
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim);
      // claim2
      const claimJwt2 = await getClaimJwt(getPayload(0));
      const newClaim2 = createClaim({
        url: newUrl2.url,
        claimer_id: newClaimer.id,
        comment: claimJwt2,
        affiliation_id: newAffiliation.id,
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim2);
    });
    it("should return null", async () => {
      // execute
      const ret = await interactor.getUrl<AggregatedUrl>(
        "no-existing-url-id",
        urlPresenter,
      );
      // assert
      if (ret) {
        assert.fail("failed to get url");
      }
    });
    it("should return 1 url", async () => {
      // execute
      const ret = await interactor.getUrl<AggregatedUrl>(
        newUrl.id,
        urlPresenter,
      );
      // assert
      if (!ret) {
        assert.fail("failed to get url");
      }
      const url = ret;
      assert.equal(url.id, newUrl.id);
      assert.equal(url.true_count, 1);
      assert.equal(url.false_count, 0);
      assert.equal(url.else_count, 0);
      assert.equal(url.verified_true_count, 1);
      assert.equal(url.verified_false_count, 0);
      assert.equal(url.verified_else_count, 0);
    });
  });
  describe("#getClaimsByUrl", () => {
    let newClaim: ClaimDocument;
    let newClaim2: ClaimDocument;
    let newClaim3: ClaimDocument;
    beforeEach(async () => {
      // url
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
    });
    describe("1 record", () => {
      /*
      /urls
        /url1
          /claim1 <- target data
        /url2
          /claim2
     */
      beforeEach(async () => {
        // claim1
        const claimJwt = await getClaimJwt(getPayload(1));
        newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt,
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);
        // claim2
        const claimJwt2 = await getClaimJwt(getPayload(0));
        newClaim2 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          comment: claimJwt2,
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim2);
        await delay(100);
      });
      it("should return 1 claim", async () => {
        // execute
        const result = await interactor.getClaimsByUrl<ClaimPresenterParams>(
          newUrl.id,
          (...args: ClaimPresenterParams) => {
            return [args[0], args[1], args[2]];
          },
        );

        // assert
        if (!result.ok) {
          assert.fail("failed to get url");
        }
        const ret = result.payload;
        assert.equal(ret.length, 1);
        const claim = ret[0][0];
        const url = ret[0][1];
        const claimer = ret[0][2];
        assert.equal(claim.id, newClaim.id);
        assert.equal(claim.affiliation_id, newAffiliation.id);
        assert.equal(url.id, newUrl.id);
        assert.equal(claimer.id, newClaimer.id);
      });
    });
    describe("2 records", () => {
      /*
      /urls
        /url1
          /claim1 <- target data
          /claim3 <- target data
        /url2
          /claim2
       */
      beforeEach(async () => {
        // claim1
        const claimJwt = await getClaimJwt(getPayload(1));
        newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);
        // claim2
        const claimJwt2 = await getClaimJwt(getPayload(0));
        newClaim2 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt2,
          created_at: dt2.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim2);
        // claim3
        const claimJwt3 = await getClaimJwt(getPayload(2));
        newClaim3 = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer2.id,
          affiliation_id: newAffiliation2.id,
          comment: claimJwt3,
          created_at: dt3.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim3);
        await delay(100);
      });
      it("should return 2 claims", async () => {
        // execute
        const result = await interactor.getClaimsByUrl<ClaimPresenterParams>(
          newUrl.id,
          (...args: ClaimPresenterParams) => {
            return [args[0], args[1], args[2]];
          },
        );

        // assert
        if (!result.ok) {
          assert.fail("failed to get url");
        }
        const ret = result.payload;
        assert.equal(ret.length, 2);
        const claim = ret[0][0];
        const url = ret[0][1];
        const claimer = ret[0][2];
        assert.equal(claim.id, newClaim3.id);
        assert.equal(claim.affiliation_id, newAffiliation2.id);
        assert.equal(url.id, newUrl.id);
        assert.equal(claimer.id, newClaimer2.id);

        const claim2 = ret[1][0];
        const url2 = ret[1][1];
        const claimer2 = ret[1][2];
        assert.equal(claim2.id, newClaim.id);
        assert.equal(claim2.affiliation_id, newAffiliation.id);
        assert.equal(url2.id, newUrl.id);
        assert.equal(claimer2.id, newClaimer.id);
      });
    });
  });
  describe("#getClaimsByClaimer", () => {
    let newClaim: ClaimDocument;
    let newClaim2: ClaimDocument;
    let newClaim3: ClaimDocument;
    let newClaim4: ClaimDocument;
    beforeEach(async () => {
      // url
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      await urlDocuments.document.put<UrlDocument>(newUrl3);
    });
    describe("1 record", () => {
      /*
      /claimers
        /claimer1
          /claim1(->url1) <- target data
       */
      beforeEach(async () => {
        const claimJwt = await getClaimJwt(getPayload(1));
        newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);

        await delay(100);
      });
      it("should return 1 claim", async () => {
        // execute
        const result =
          await interactor.getClaimsByClaimer<ClaimPresenterParams>(
            newClaimer.id,
            (...args: ClaimPresenterParams) => {
              return [args[0], args[1], args[2], args[3]];
            },
          );

        // assert
        if (!result.ok) {
          assert.fail("failed to get url");
        }
        const ret = result.payload;
        assert.equal(ret.length, 1);
        const claim = ret[0][0];
        const url = ret[0][1];
        const claimer = ret[0][2];
        const organization = ret[0][3]!;
        assert.equal(claim.id, newClaim.id);
        assert.equal(claim.affiliation_id, newAffiliation.id);
        assert.equal(url.id, newUrl.id);
        assert.equal(url.true_count, 1);
        assert.equal(url.false_count, 0);
        assert.equal(url.else_count, 0);
        assert.equal(claimer.id, newClaimer.id);
        assert.equal(organization, newAffiliation.organization);
      });
    });
    describe("2 records", () => {
      /*
      /claimers
        /claimer1
          /claim1(->url1, true) <- target data
          /claim2(->url2, false) <- target data
        /claimer2
          /claim3(->url1, true) <- calculated target
          /claim4(->url3)
       */
      beforeEach(async () => {
        // claim1
        const claimJwt = await getClaimJwt(getPayload(1));
        newClaim = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt,
          created_at: dt.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim);
        // claim2
        const claimJwt2 = await getClaimJwt(getPayload(0));
        newClaim2 = createClaim({
          url: newUrl2.url,
          claimer_id: newClaimer.id,
          affiliation_id: newAffiliation.id,
          comment: claimJwt2,
          created_at: dt2.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim2);
        // claim3
        const claimJwt3 = await getClaimJwt(getPayload(1));
        newClaim3 = createClaim({
          url: newUrl.url,
          claimer_id: newClaimer2.id,
          comment: claimJwt3,
          affiliation_id: newAffiliation2.id,
          created_at: dt3.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim3);
        // claim4
        const claimJwt4 = await getClaimJwt(getPayload(1));
        newClaim4 = createClaim({
          url: newUrl3.url,
          claimer_id: newClaimer2.id,
          affiliation_id: newAffiliation2.id,
          comment: claimJwt4,
          created_at: dt4.toISOString(),
        });
        await claimDocuments.document.put<ClaimDocument>(newClaim4);

        await delay(100);
      });
      it("should return 2 claim", async () => {
        // execute
        const result =
          await interactor.getClaimsByClaimer<ClaimPresenterParams>(
            newClaimer.id,
            (...args: ClaimPresenterParams) => {
              return [args[0], args[1], args[2], args[3]];
            },
          );

        // assert
        if (!result.ok) {
          assert.fail("failed to get url");
        }
        const ret = result.payload;
        assert.equal(ret.length, 2);

        const claim = ret[0][0];
        const url = ret[0][1];
        const claimer = ret[0][2];
        const organization = ret[0][3]!;
        assert.equal(claim.id, newClaim2.id);
        assert.equal(claim.affiliation_id, newAffiliation.id);
        assert.equal(url.id, newUrl2.id);
        assert.equal(url.true_count, 0);
        assert.equal(url.false_count, 1);
        assert.equal(url.else_count, 0);
        assert.equal(claimer.id, newClaimer.id);
        assert.equal(organization, newAffiliation.organization);

        const claim2 = ret[1][0];
        const url2 = ret[1][1];
        const claimer2 = ret[1][2];
        const organization2 = ret[1][3]!;
        assert.equal(claim2.id, newClaim.id);
        assert.equal(claim2.affiliation_id, newAffiliation.id);
        assert.equal(url2.id, newUrl.id);
        assert.equal(url2.true_count, 2);
        assert.equal(url2.false_count, 0);
        assert.equal(url2.else_count, 0);
        assert.equal(claimer2.id, newClaimer.id);
        assert.equal(organization2, newAffiliation.organization);
      });
    });
  });
  describe("#getClaim", () => {
    let newClaim: ClaimDocument;
    let newClaim2: ClaimDocument;
    let newClaim3: ClaimDocument;
    /*
    /urls
      /url1
        /claim1 <- target data
        /claim3
      /url2
        /claim2
     */
    beforeEach(async () => {
      // url
      await urlDocuments.document.put<UrlDocument>(newUrl);
      await urlDocuments.document.put<UrlDocument>(newUrl2);
      // claim1
      const claimJwt = await getClaimJwt(getPayload(1));
      newClaim = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt,
        created_at: dt.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim);
      // claim2
      const claimJwt2 = await getClaimJwt(getPayload(0));
      newClaim2 = createClaim({
        url: newUrl2.url,
        claimer_id: newClaimer.id,
        affiliation_id: newAffiliation.id,
        comment: claimJwt2,
        created_at: dt2.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim2);
      // claim3
      const claimJwt3 = await getClaimJwt(getPayload(1));
      newClaim3 = createClaim({
        url: newUrl.url,
        claimer_id: newClaimer2.id,
        comment: claimJwt3,
        affiliation_id: newAffiliation2.id,
        created_at: dt3.toISOString(),
      });
      await claimDocuments.document.put<ClaimDocument>(newClaim3);
    });
    it("should return 1 claim", async () => {
      // execute
      const ret = await interactor.getClaim<ClaimPresenterParams>(
        newClaim.id,
        (...args: ClaimPresenterParams) => {
          return [args[0], args[1], args[2], args[3]];
        },
      );

      // assert
      if (!ret) {
        assert.fail("failed to get url");
      }
      const claim = ret[0];
      const url = ret[1];
      const claimer = ret[2];
      assert.equal(claim.id, newClaim.id);
      assert.equal(claim.affiliation_id, newAffiliation.id);
      assert.equal(url.id, newUrl.id);
      assert.equal(url.true_count, 2);
      assert.equal(url.false_count, 0);
      assert.equal(url.else_count, 0);
      assert.equal(url.verified_true_count, 2);
      assert.equal(url.verified_false_count, 0);
      assert.equal(url.verified_else_count, 0);
      assert.equal(claimer.id, newClaimer.id);
      const organization = ret[3];
      assert.equal(organization, newAffiliation.organization);
    });
  });
  describe("#getClaimer", () => {
    it("should return 1 claim", async () => {
      // execute
      const ret = await interactor.getClaimer<ClaimerDocument>(
        newClaimer.id,
        (claimer: ClaimerDocument) => {
          return claimer;
        },
      );

      // assert
      if (!ret) {
        assert.fail("failed to get url");
      }
      const claimer = ret;
      assert.equal(claimer.id, newClaimer.id);
      assert.equal(claimer?.icon, newClaimer.icon);
      assert.equal(claimer?.id_token, newClaimer.id_token);
      // assert.equal(claimer?.organization, newClaimer.organization);
      assert.equal(claimer?.created_at, newClaimer.created_at);
    });
  });
  describe("#putClaim", () => {
    let mockAgent: ReturnType<typeof initMockAgent>;

    const presenter: NewClaimPresenter<{ claimDoc: ClaimDocument }> = (
      claim,
    ) => {
      return { claimDoc: claim };
    };

    const URL = "http://example.com";
    beforeEach(async () => {
      mockAgent = initMockAgent();
      mockAgent.getAccess(URL, "/", mockHtml, {
        statusCode: 200,
        headers: { "content-type": "text/html" },
      });
    });

    afterEach(async () => {
      await mockAgent.close();
    });

    describe("bad input", () => {
      it("should resulted in failure", async () => {
        // generate test data
        const id_token = "bad jwt string";
        const comment = "bad jwt string";

        // execute
        const payload = { comment, id_token };
        const result = await interactor.putClaim(payload, presenter);

        // assert
        if (result.ok) {
          assert.fail();
        }
        assert.equal(result.error.type, "INVALID_PARAMETER");
      });
    });
    describe("new url", () => {
      it("should resulted in [new claimer, new url, new claim]", async () => {
        // generate test data
        const id_token = await createIdToken();
        const comment = await getClaimJwt(
          createClaimPayload({ url: URL, boolValue: 1 }),
        );

        // execute
        const payload = { comment, id_token };
        await interactor.putClaim(payload, presenter);

        // assert
        const urls = await urlDocuments.document.all<UrlDocument>();
        assert.equal(urls.length, 1);
        const claimers = await claimerDocuments.document.all<ClaimerDocument>();
        assert.equal(claimers.length, 3);
        const claims = await claimDocuments.document.all<ClaimDocument>();
        assert.equal(claims.length, 1);
      });
    });
    describe("registered url", () => {
      it("should resulted in [new claimer, new claim]", async () => {
        const url = URL;
        // generate test data
        const id_token = await createIdToken();
        const comment = await getClaimJwt(
          createClaimPayload({ url, boolValue: 1 }),
        );
        const registeredUrl = createUrl({ url });
        // register test data
        await urlDocuments.document.put<UrlDocument>(registeredUrl);

        // execute
        const payload = { comment, id_token };
        await interactor.putClaim(payload, presenter);

        // assert
        const urls = await urlDocuments.document.all<UrlDocument>();
        assert.equal(urls.length, 1);
        const claimers = await claimerDocuments.document.all<ClaimerDocument>();
        assert.equal(claimers.length, 3);
        const claims = await claimDocuments.document.all<ClaimDocument>();
        assert.equal(claims.length, 1);
      });
    });
    describe("new claimer", () => {
      describe("with affiliation", () => {
        it("should resulted in [new claimer, new url, new claim, new affiliation]", async () => {
          // generate test data
          const id_token = await createIdToken();
          const comment = await getClaimJwt(
            createClaimPayload({ url: URL, boolValue: 1 }),
          );
          const affiliation = await createSdJwt({}, []);

          // execute
          const payload = { id_token, comment, affiliation };
          await interactor.putClaim(payload, presenter);

          // assert
          const urls = await urlDocuments.document.all<UrlDocument>();
          assert.equal(urls.length, 1);
          const claimers =
            await claimerDocuments.document.all<ClaimerDocument>();
          assert.equal(claimers.length, 3);
          const claims = await claimDocuments.document.all<ClaimDocument>();
          assert.equal(claims.length, 1);
          const affiliations = (
            await affiliationDocuments.document.all<AffiliationDocument>()
          ).filter((doc) => doc.value.claimer_sub !== "N/A");
          assert.equal(affiliations.length, 3);
        });
      });
    });
    describe("registered claimer", () => {
      describe("with registered affiliation", () => {
        it("should resulted in [new url, new claim]", async () => {
          // generate test data
          const id_token = await createIdToken();
          const sub = extractClaimerSub(id_token) as DecodeOk;
          const registeredClaimer = createClaimer({ sub: sub.value });
          const comment = await getClaimJwt(
            createClaimPayload({ url: URL, boolValue: 1 }),
          );
          const iss = "https://datasign.jp";
          const iat = currentTime();
          const affiliation = await createSdJwt({}, [], { iss, iat });
          const registeredAffiliation = createAffiliation({
            claimer_id: registeredClaimer.id,
            claimer_sub: sub.value,
            organization: affiliation,
          });

          // register test data
          await claimerDocuments.document.put<ClaimerDocument>(
            registeredClaimer,
          );
          await affiliationDocuments.document.put<AffiliationDocument>(
            registeredAffiliation,
          );

          // execute
          const payload = { id_token, comment, affiliation };
          await interactor.putClaim(payload, presenter);

          // assert
          // new url
          const urls = await urlDocuments.document.all<UrlDocument>();
          assert.equal(urls.length, 1);
          // registered claimer
          const claimers =
            await claimerDocuments.document.all<ClaimerDocument>();
          assert.equal(claimers.length, 3); // not increased
          // registered affiliation
          const affiliations =
            await affiliationDocuments.document.query<AffiliationDocument>(
              (doc) => doc.claimer_id === registeredClaimer.id,
            );
          assert.equal(affiliations.length, 2);
          const affSorted = affiliations.sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          );
          // new claim
          const claims = await claimDocuments.document.all<ClaimDocument>();
          assert.equal(claims.length, 1);
          assert.equal(claims[0].value.url, urls[0].value.url);
          assert.equal(claims[0].value.claimer_id, claimers[2].value.id);
          assert.equal(claims[0].value.affiliation_id, affSorted[1].id); // latest affiliation
        });
      });
      describe("without new affiliation", () => {
        it("should resulted in [new url, new claim]", async () => {
          // generate test data
          const id_token = await createIdToken();
          const sub = extractClaimerSub(id_token) as DecodeOk;
          const registeredClaimer = createClaimer({ sub: sub.value });
          const comment = await getClaimJwt(
            createClaimPayload({ url: URL, boolValue: 1 }),
          );
          const iss = "https://datasign.jp";
          const iat = currentTime();
          const affiliation = await createSdJwt({}, [], { iss, iat });
          const registeredAffiliation = createAffiliation({
            claimer_id: registeredClaimer.id,
            claimer_sub: sub.value,
            organization: affiliation,
          });

          // register test data
          await claimerDocuments.document.put<ClaimerDocument>(
            registeredClaimer,
          );
          await affiliationDocuments.document.put<AffiliationDocument>(
            registeredAffiliation,
          );

          // execute
          const payload = { id_token, comment };
          await interactor.putClaim(payload, presenter);

          // assert
          // new url
          const urls = await urlDocuments.document.all<UrlDocument>();
          assert.equal(urls.length, 1);
          // registered claimer
          const claimers =
            await claimerDocuments.document.all<ClaimerDocument>();
          assert.equal(claimers.length, 3);
          // registered affiliation
          const affiliations =
            await affiliationDocuments.document.all<AffiliationDocument>();
          assert.equal(affiliations.length, 3);
          // new claim
          const claims = await claimDocuments.document.all<ClaimDocument>();
          assert.equal(claims.length, 1);
          assert.equal(claims[0].value.url, urls[0].value.url);
          assert.equal(claims[0].value.claimer_id, claimers[2].value.id);
          assert.equal(
            claims[0].value.affiliation_id,
            affiliations[2].value.id,
          );
        });
      });
      describe("with new affiliation", () => {
        it("should resulted in [new url, new affiliation, new claim]", async () => {
          // generate test data
          const id_token = await createIdToken();
          const sub = extractClaimerSub(id_token) as DecodeOk;
          const registeredClaimer = createClaimer({ sub: sub.value });
          const comment = await getClaimJwt(
            createClaimPayload({ url: URL, boolValue: 1 }),
          );
          const iss = "https://datasign.jp";
          const iat = currentTime();
          const affiliation = await createSdJwt({}, [], { iss, iat });
          const registeredAffiliation = createAffiliation({
            claimer_id: registeredClaimer.id,
            claimer_sub: sub.value,
            organization: affiliation,
          });
          const newAffiliation = await createSdJwt({}, [], {
            iss,
            iat: iat + 1,
          });

          // register test data
          await claimerDocuments.document.put<ClaimerDocument>(
            registeredClaimer,
          );
          await affiliationDocuments.document.put<AffiliationDocument>(
            registeredAffiliation,
          );

          // execute
          const payload = { id_token, comment, affiliation: newAffiliation };
          await interactor.putClaim(payload, presenter);

          // assert
          // new url
          const urls = await urlDocuments.document.all<UrlDocument>();
          assert.equal(urls.length, 1);
          // registered claimer
          const claimers =
            await claimerDocuments.document.all<ClaimerDocument>();
          assert.equal(claimers.length, 3);
          // registered affiliation
          const affiliations = (
            await affiliationDocuments.document.all<AffiliationDocument>()
          ).filter((doc) => doc.value.claimer_sub !== "N/A");
          assert.equal(affiliations.length, 4);
          affiliations.sort(
            (a, b) =>
              new Date(b.value.created_at).getTime() -
              new Date(a.value.created_at).getTime(),
          );
          const latestAffiliation = affiliations[0];
          // new claim
          const claims = await claimDocuments.document.all<ClaimDocument>();
          assert.equal(claims.length, 1);
          assert.equal(claims[0].value.url, urls[0].value.url);
          assert.equal(claims[0].value.claimer_id, claimers[2].value.id);
          assert.equal(
            claims[0].value.affiliation_id,
            affiliations[0].value.id,
          );
        });
      });
    });
  });
  describe("#deleteClaim", () => {
    let id = "";
    let idToken = "";
    beforeEach(async () => {
      idToken = await createIdToken();
      const sub = extractSub(idToken)!;
      const urlDoc = await repository.putUrl({
        url: faker.internet.url(),
        title: faker.string.alpha(10),
        description: faker.string.alpha(10),
        contentType: "text/html",
        image: [{ width: 0, url: faker.image.dataUri() }],
      });
      const claimerDoc = await repository.putClaimer({
        idToken: "dummy-token",
        sub,
        icon: "dummy-icon",
      });
      const claim = await repository.putClaim({
        comment: "test comment",
        urlDoc,
        claimerDoc,
        affiliationDoc: undefined,
      });
      id = claim.id;
    });

    afterEach(async () => {});
    describe("ng case", () => {
      describe("invalid parameters", () => {
        it("should return invalid parameters(invalid payload)", async () => {
          const invalidIdToken = "";
          const result = await interactor.deleteClaim(id, invalidIdToken);
          if (result.ok) {
            assert.fail("should not be ok");
          }
          const { type } = result.error;
          assert.equal(type, "INVALID_PARAMETER");
        });
        it("should return invalid parameters(mismatch id_token)", async () => {
          const idToken2 = await createIdToken();
          const result = await interactor.deleteClaim(id, idToken2);
          if (result.ok) {
            assert.fail("should not be ok");
          }
          const { type } = result.error;
          assert.equal(type, "INVALID_PARAMETER");
        });
      });
      describe("not found", () => {
        it("should return not found", async () => {
          const noSuchId = "no-such-id";
          const result = await interactor.deleteClaim(noSuchId, idToken);
          if (result.ok) {
            assert.fail("should not be ok");
          }
          const { type } = result.error;
          assert.equal(type, "NOT_FOUND");
        });
      });
    });
    describe("ok case", () => {
      it("should return ok", async () => {
        const claimBeforeDelete = await repository.getClaimById(id);
        assert.equal(claimBeforeDelete?.deleted_at, undefined);
        const result = await interactor.deleteClaim(id, idToken);
        if (result.ok) {
          const claimAfterDelete = await repository.getClaimById(id);
          assert.isNull(claimAfterDelete);
        } else {
          assert.fail("should be ok");
        }
      });
    });
  });
});

type UrlPresenterParams = Parameters<UrlPresenter<UrlDocument>>;
type ClaimPresenterParams = Parameters<ClaimPresenter<ClaimDocument>>;
type ClaimerPresenterParams = Parameters<ClaimerPresenter<ClaimerDocument>>;
