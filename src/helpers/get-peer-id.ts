import { promises as fs } from "fs";
import path from "path";
import {
  createEd25519PeerId,
  createFromProtobuf,
  exportToProtobuf,
} from "@libp2p/peer-id-factory";

export async function loadAndUsePeerId(filePath = "./peer-id.bin") {
  try {
    await fs.access(filePath);
  } catch (err) {
    console.log(`File not found at ${filePath}, generating a new PeerId...`);
    return await generateAndSerializePeerId(filePath);
  }
  // 保存されたプロトコルバッファのデータをファイルから読み込む
  const protobufData = await fs.readFile(filePath);

  // PeerIdをプロトコルバッファからデシリアライズ
  const peerId = await createFromProtobuf(protobufData);

  console.log("PeerId loaded (from protobuf):", peerId.toString());
  return peerId;
}

export const generateAndSerializePeerId = async (
  filePath = "./peer-id.bin",
) => {
  // PeerIdを生成
  const peerId = await createEd25519PeerId();

  // PeerIdをプロトコルバッファでシリアライズ（秘密鍵を含む）
  const protobufData = exportToProtobuf(peerId);

  // シリアライズされたバイナリデータをファイルに保存
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, protobufData);

  console.log("PeerId created and saved (as protobuf):", peerId.toString());
  return peerId;
};
