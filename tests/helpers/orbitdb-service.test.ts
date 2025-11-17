import * as fs from "fs/promises";
import * as path from "path";

import { assert, expect } from "chai";

import { createLibp2p } from "libp2p";

import { setupNode } from "../../src/orbit-db/index.js";
import {
  generateAndSerializePeerId,
  getLibp2pOptions,
  loadAndDesSerializePeerId,
} from "../../src/helpers/libp2p-helper.js";
import { randomUniqueString } from "../../src/utils/random-util.js";
import { DocumentValue } from "@orbitdb/core";
import { clearDir, generateTemporaryPath } from "../test-utils.js";
import { onUpdate } from "../../src/local-data/on-update.js";

interface UrlDocument {
  url: string;
}

const clearStorage = async (path: string) => {
  try {
    await fs.rm(path, { recursive: true, force: true });
    console.log(`Directory ${path} deleted.`);
  } catch (err) {
    console.error(`Failed to delete directory: ${err}`);
  }
};

const tmpPath = path.join("tests", "tmp");

describe("OrbitdbService", () => {
  describe("#setupNode", () => {
    beforeEach(async () => {
      await clearStorage(tmpPath);
    });
    afterEach(async () => {
      await clearStorage(tmpPath);
    });

    it("should setup node successfully", async () => {
      const rootPath = "tmp/1a";
      const ipfsPath = path.join("tests", `${rootPath}/ipfs/blocks`);
      const orbitdbPath = path.join("tests", `${rootPath}/orbitdb`);
      const keystorePath = path.join("tests", `${rootPath}/keystore`);
      const node = await setupNode(getLibp2pOptions(), {
        ipfsPath,
        orbitdbPath,
        identityKey: "main_peer",
        keystorePath,
      });
      await node.close();
    });

    it("should fail to setup node on the same port", async () => {
      const rootPath = "tmp/1b";
      const ipfsPath = path.join("tests", `${rootPath}/ipfs/blocks`);
      const orbitdbPath = path.join("tests", `${rootPath}/orbitdb`);
      const keystorePath = path.join("tests", `${rootPath}/keystore`);
      const node1 = await setupNode(
        getLibp2pOptions({ listenAddresses: ["/ip4/0.0.0.0/tcp/4001"] }),
        {
          ipfsPath,
          orbitdbPath,
          identityKey: "main_peer",
          keystorePath,
        },
      );
      // try setup on the port same above
      try {
        const node2 = await setupNode(
          getLibp2pOptions({ listenAddresses: ["/ip4/0.0.0.0/tcp/4001"] }),
          {
            ipfsPath,
            orbitdbPath,
            identityKey: "sub_peer",
            keystorePath,
          },
        );
        assert.fail("should be `CREATE_LIB_P2P_ERROR`");
      } catch (error) {
        assert.equal((error as Error).message, "CREATE_LIB_P2P_ERROR");
      }
      await node1.close();
    });

    it("should fail to setup node on the same identity path", async () => {
      const rootPath = "tmp/1c";
      const ipfsPath = path.join("tests", `${rootPath}/ipfs/blocks`);
      const orbitdbPath = path.join("tests", `${rootPath}/orbitdb`);
      const keystorePath = path.join("tests", `${rootPath}/keystore`);
      const node1 = await setupNode(getLibp2pOptions(), {
        ipfsPath,
        orbitdbPath,
        identityKey: "main_peer",
        keystorePath,
      });
      // try setup on the port same above
      try {
        await setupNode(getLibp2pOptions(), {
          ipfsPath,
          orbitdbPath,
          identityKey: "sub_peer",
          keystorePath,
        });
        assert.fail("should be `CREATE_KEYSTORE_ERROR`");
      } catch (error) {
        assert.equal((error as Error).message, "CREATE_KEYSTORE_ERROR");
      }
      await node1.close();
    });
  });

  describe("Setup Main Peer", () => {
    let ipfsPath: string;
    let orbitdbPath: string;
    let keystorePath: string;
    beforeEach(async () => {
      await clearDir();
      ipfsPath = generateTemporaryPath("ipfs", "blocks");
      orbitdbPath = generateTemporaryPath("orbitdb");
      keystorePath = generateTemporaryPath("keystore");
    });

    it("should open documents successfully", async () => {
      const node = await setupNode(getLibp2pOptions(), {
        ipfsPath,
        orbitdbPath,
        identityKey: "main_peer",
        keystorePath,
      });
      const docType1 = { name: "urls", indexBy: "url" };
      const { documents, closeDocuments } = await node.openDocuments([
        docType1,
      ]);

      const url1 = "https://example.com";
      const url2 = "https://example2.com";
      const document = documents[docType1.name];
      await document.document.put<UrlDocument>({ url: url1 });
      // await document.document.put<UrlDocument>({ url: url1 });
      let doc = await document.document.get<DocumentValue<UrlDocument>>(url1);
      if (doc) {
        assert.equal(url1, doc.value.url);
      } else {
        assert.fail("failed to get document");
      }
      doc = await document.document.get<DocumentValue<UrlDocument>>(url2);
      if (doc) {
        assert.fail("failed to get document");
      }
      await closeDocuments();
      await node.close();
      // assert.equal(peerId.toString(), peerIdLoaded.toString());
    });

    interface RequestAtResponseEndpoint {
      transaction_id: string;
      issued_at: number;
      expired_in: number;
    }
    it("should open key-value-indexed successfully", async () => {
      const node = await setupNode(getLibp2pOptions(), {
        ipfsPath,
        orbitdbPath,
        identityKey: "main_peer",
        keystorePath,
      });
      const keyValueType1 = { name: "requests" };
      const { keyValues, closeKeyValues } = await node.openKeyValueIndexed([
        keyValueType1,
      ]);

      const key = randomUniqueString();
      const request: RequestAtResponseEndpoint = {
        transaction_id: randomUniqueString(),
        issued_at: new Date().getTime() / 1000,
        expired_in: 600,
      };
      const keyValue = keyValues[keyValueType1.name];
      await keyValue.db.put<RequestAtResponseEndpoint>(key, request);
      let value = await keyValue.db.get<RequestAtResponseEndpoint>(key);
      if (value) {
        assert.equal(value.transaction_id, request.transaction_id);
      } else {
        assert.fail("failed to get document");
      }
      let value2 =
        await keyValue.db.get<RequestAtResponseEndpoint>("no-such-key");
      if (value2) {
        assert.fail("failed to get document");
      }
      await closeKeyValues();
      await node.close();
    });
  });

  describe("Sync Documents", () => {
    const rootPath = "tmp/3";
    const ipfsPath = path.join("tests", `${rootPath}/ipfs/blocks`);
    const ipfsPath2 = path.join("tests", `${rootPath}/ipfs2/blocks`);
    const orbitdbPath = path.join("tests", `${rootPath}/orbitdb`);
    const orbitdbPath2 = path.join("tests", `${rootPath}/orbitdb2`);
    const keystorePath = path.join("tests", `${rootPath}/keystore`);
    const keystorePath2 = path.join("tests", `${rootPath}/keystore2`);

    before(async () => {
      await clearStorage(tmpPath);
    });

    it("should sync to main peer", async () => {
      const node1 = await setupNode(
        getLibp2pOptions({ listenAddresses: ["/ip4/0.0.0.0/tcp/4001"] }),
        {
          ipfsPath,
          orbitdbPath,
          identityKey: "main_peer",
          keystorePath: keystorePath,
        },
      );
      const docType1 = { name: "urls", indexBy: "url" };
      const docs1 = await node1.openDocuments([docType1]);

      const document = docs1.documents[docType1.name];

      /*
        put data at node1
       */
      const url1 = "https://example.com";
      const url2 = "https://example2.com";

      await document.document.put<UrlDocument>({ url: url1 });

      const node2 = await setupNode(
        getLibp2pOptions({ listenAddresses: ["/ip4/0.0.0.0/tcp/4002"] }),
        {
          ipfsPath: ipfsPath2,
          orbitdbPath: orbitdbPath2,
          identityKey: "sub_peer",
          keystorePath: keystorePath2,
        },
      );

      /*
        grant
       */
      const requester = node2.getPeerInfo();
      const grantResult = await node1.grant(docs1.documents, requester);
      if (!grantResult.ok) {
        assert.fail("failed to grant");
      }

      /*
        sync
       */
      const syncArgs = node1.getDocumentsInfo(docs1.documents);
      const { onUpdateClaims, onUpdateUrls } = await onUpdate();
      const syncResult = await node2.syncDocuments(syncArgs, {
        urls: onUpdateUrls,
        claims: onUpdateClaims,
      });
      if (!syncResult.ok) {
        assert.fail("failed to setup node");
      }
      const docs2 = syncResult.payload;
      console.log("get all data");
      console.log(
        (await docs2.documents[docType1.name].document.all<UrlDocument>()).map(
          (e) => e.value,
        ),
      );
      console.log((await document.document.all()).map((e) => e.value));

      const document2 = docs2.documents[docType1.name];

      /*
        put data at node2
       */
      // await document2.put<UrlDocument>({ url: url2 });

      // todo assert synced data getting
      // /*
      //   get data from node2
      //  */
      // let data2 = await document2.document.get<UrlDocument>(url1);
      // if (data2) {
      //   assert.equal(url1, data2.value.url);
      // } else {
      //   assert.fail("failed to get document");
      // }

      await docs1.closeDocuments();
      await node1.close();

      await docs2.closeDocuments();
      await node2.close();
      // assert.equal(peerId.toString(), peerIdLoaded.toString());
    });
  });
});
