import {
  createEd25519PeerId,
  createFromProtobuf,
  exportToProtobuf,
} from "@libp2p/peer-id-factory";
import { tcp } from "@libp2p/tcp";
import { PeerId } from "@libp2p/interface";
import { identify } from "@libp2p/identify";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { createLibp2p, Libp2pOptions } from "libp2p";

export const generateAndSerializePeerId = async () => {
  // PeerIdを生成
  const peerId = await createEd25519PeerId();

  // PeerIdをプロトコルバッファでシリアライズ（秘密鍵を含む）
  const protobufData = exportToProtobuf(peerId);

  console.log("PeerId created and saved (as protobuf):", peerId.toString());
  return { peerId, protobufData };
};

export const loadAndDesSerializePeerId = async (protobufData: Uint8Array) => {
  // PeerIdをプロトコルバッファからデシリアライズ
  const peerId = await createFromProtobuf(protobufData);

  console.log("PeerId loaded (from protobuf):", peerId.toString());
  return peerId;
};

export const getLibp2pOptions = (
  opts: {
    listenAddresses?: string[];
    peerId?: PeerId;
  } = {},
) => {
  // https://docs.libp2p.io/concepts/transports/listen-and-dial/
  let optsRet: Libp2pOptions = {
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
    },
  };
  if (opts.listenAddresses) {
    optsRet.addresses = {
      listen: opts.listenAddresses,
    };
  }
  if (opts.peerId) {
    optsRet.peerId = opts.peerId;
  }
  return optsRet;
};
