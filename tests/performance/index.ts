import { Docs, setupNode } from "../../src/orbit-db/index.js";
import { initClaimRepository } from "../../src/usecases/claim-repository.js";
import { getLibp2pOptions } from "../../src/helpers/libp2p-helper.js";
import { ClaimerDocument, UrlDocument } from "../../src/usecases/types.js";
import {
  createClaimPayload,
  createIdToken,
  extractSub,
  getClaimJwt,
} from "../test-utils.js";
import { faker } from "@faker-js/faker";
import { SqlClient, initClient } from "../../src/local-data/sqlite-client.js";
import { onUpdate } from "../../src/local-data/on-update.js";
import { promises as fs } from "fs";
import path from "path";
import { syncers } from "../../src/local-data/syncer.js";

export const createRandomPicker = <T>(data: T[]) => {
  // データのコピーを作成（元データを変更しない）
  const availableData = [...data];

  const getRandomDocuments = (count: number): T[] => {
    if (count > availableData.length) {
      throw new Error("Not enough items remaining to fulfill the request");
    }

    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * availableData.length);
      result.push(availableData[randomIndex]);
      availableData.splice(randomIndex, 1); // 選んだ要素を除外
    }

    return result;
  };

  return {
    getRandomDocuments,
    getRemainingCount: () => availableData.length,
  };
};

const baseDir =
  "/Users/ryousuke/repositories/mic2024/mic2024-backend/peer1/tmp";
// const baseDir = "/tmp/bool-node";

export const clearDir = async () => {
  try {
    await fs.rm(baseDir, { recursive: true, force: true });
    console.log(`Directory ${baseDir} deleted.`);
  } catch (err) {
    console.error(`Failed to delete directory: ${err}`);
  }
};

process.env.NODE_ENV = "local";
export const initGenerator = async (reset: boolean = false) => {
  let docs: Docs | null = null;
  let ipfsPath: string;
  let orbitdbPath: string;
  let keystorePath: string;

  const dbPath = `${baseDir}/database.sqlite`;
  if (reset) {
    await clearDir();
    await fs.mkdir(baseDir, { recursive: true });
  }
  const sqlClient = await initClient(dbPath);

  if (reset) {
    await sqlClient.destroy();
    await sqlClient.init();
  }

  ipfsPath = `${baseDir}/ipfs/blocks`;
  orbitdbPath = `${baseDir}/orbitdb`;
  keystorePath = `${baseDir}/keystore`;

  const __syncers = await syncers(dbPath);
  const { syncUrl, syncClaim, syncAffiliation } = __syncers;
  const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } = await onUpdate(
    { syncUrl, syncClaim, syncAffiliation, label: "TestScript" },
  );

  const node = await setupNode(getLibp2pOptions(), {
    ipfsPath,
    orbitdbPath,
    keystorePath,
    identityKey: "main_peer",
  });
  const DocType = {
    urls: { name: "urls", indexBy: "id", onUpdate: onUpdateUrls },
    claimers: { name: "claimers", indexBy: "id" },
    claims: { name: "claims", indexBy: "id", onUpdate: onUpdateClaims },
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
  const repository = initClaimRepository(docs);

  const getAllUrls = async () => {
    return await repository.getUrlAll();
  };

  const urls = async (urlCount: number) => {
    const urlDocuments = [];
    for (let i = 0; i < urlCount; i++) {
      if (i % 1000 === 0) {
        console.log(`registered:${i}`);
      }
      const urlDoc = await repository.putUrl({
        url: faker.internet.url(),
        title: faker.string.alpha(10),
        description: faker.string.alpha(10),
        contentType: "text/html",
        image: [{ width: 0, url: faker.image.dataUri() }],
      });
      urlDocuments.push(urlDoc);
    }

    return urlDocuments;
  };

  const claimers = async (claimerCount: number) => {
    const claimerDocuments = [];
    for (let i = 0; i < claimerCount; i++) {
      const idToken = await createIdToken();
      const sub = extractSub(idToken)!;
      const claimerDoc = await repository.putClaimer({
        idToken,
        sub,
        icon: "dummy",
      });
      claimerDocuments.push(claimerDoc);
    }
    return claimerDocuments;
  };

  const claims = async (
    urlCount: number,
    claimsByUrlCount: number,
    urlPicker: RandomPicker<UrlDocument>,
    claimerDocuments: ClaimerDocument[],
  ) => {
    const batch = urlPicker.getRandomDocuments(urlCount);
    let urlIndex = 0;
    for (const urlDoc of batch) {
      console.log(urlIndex, `add claim of ${urlDoc.url}`);
      urlIndex++;
      const claimerPicker = createRandomPicker(claimerDocuments);
      for (let i = 0; i < claimsByUrlCount; i++) {
        const claimerDoc = claimerPicker.getRandomDocuments(1)[0];
        await repository.putClaim({
          comment: await getClaimJwt(createClaimPayload()),
          urlDoc,
          claimerDoc,
        });
      }
    }
  };

  return { urls, claimers, claims, getAllUrls };
};
export type RandomPicker<T> = ReturnType<typeof createRandomPicker<T>>;

const reader = async () => {
  const generator = await initGenerator(false);

  let startTime = Date.now();
  const all = await generator.getAllUrls();
  let endTime = Date.now();

  console.log(
    `Execution Time(Get ${all.length} Urls):`,
    endTime - startTime,
    "ms",
  );
  // console.log(all[0].value);
};

export const register = async () => {
  const generator = await initGenerator(true);

  // ------------------------- urls --------------------------------
  let startTime = Date.now();
  const urlDocuments = await generator.urls(2);
  // const urlDocuments = await generator.urls(5000);
  // const urlDocuments = await generator.urls(10000);
  // const urlDocuments = await generator.urls(40515);
  let endTime = Date.now();

  console.log(
    `Execution Time(Put ${urlDocuments.length} Urls):`,
    endTime - startTime,
    "ms",
  );

  // // ------------------------- claimers --------------------------------
  startTime = Date.now();
  // const claimerDocuments = await generator.claimers(10);
  const claimerDocuments = await generator.claimers(1000);
  endTime = Date.now();
  //
  // console.log(
  //   `Execution Time(Put ${claimerDocuments.length} Claimers):`,
  //   endTime - startTime,
  //   "ms",
  // );
  //
  // // ------------------------- claims --------------------------------
  const urlPicker = createRandomPicker(urlDocuments);

  await generator.claims(2, 10, urlPicker, claimerDocuments); // batch1
  // await generator.claims(365, 100, urlPicker, claimerDocuments); // batch1
  // await generator.claims(3650, 10, urlPicker, claimerDocuments); // batch2
  // await generator.claims(36500, 1, urlPicker, claimerDocuments); // batch3
  // await generator.claims(365, 100); // batch1
  // await generator.claims(3650, 10); // batch2
  // await generator.claims(36500, 1); // batch3
};

await register();
// await reader();
