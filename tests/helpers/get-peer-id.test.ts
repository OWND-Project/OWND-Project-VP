import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { expect } from "chai";
import {
  loadAndUsePeerId,
  generateAndSerializePeerId,
} from "../../src/helpers/get-peer-id.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("loadAndUsePeerId", () => {
  const testFilePath = path.resolve(__dirname, "test-peer-id.bin");

  // テスト前のセットアップ
  beforeEach(async () => {
    // テスト用のファイルが存在する場合は削除
    try {
      await fs.unlink(testFilePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  });

  // テスト後のクリーンアップ
  afterEach(async () => {
    // テスト用のファイルを削除
    try {
      await fs.unlink(testFilePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  });

  it("should generate and save a PeerId when the file does not exist", async () => {
    const peerId = await loadAndUsePeerId(testFilePath);

    // PeerIdが返されることを確認
    expect(peerId).to.exist;
    expect(peerId.toString()).to.be.a("string");

    // ファイルが作成されたことを確認
    const fileExists = await fs
      .access(testFilePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).to.be.true;
  });

  it("should load a PeerId from an existing file", async () => {
    // 事前にPeerIdを生成して保存
    const generatedPeerId = await generateAndSerializePeerId(testFilePath);

    // PeerIdをロード
    const loadedPeerId = await loadAndUsePeerId(testFilePath);

    // 同じPeerIdであることを確認
    expect(loadedPeerId.toString()).to.equal(generatedPeerId.toString());
  });
});
