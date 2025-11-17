import { assert } from "chai";

import { createLibp2p } from "libp2p";

import {
  generateAndSerializePeerId,
  getLibp2pOptions,
  loadAndDesSerializePeerId,
} from "../../src/helpers/libp2p-helper.js";

describe("generate peer id", () => {
  it("generate and save peer id", async () => {
    const { peerId, protobufData } = await generateAndSerializePeerId();
    const peerIdLoaded = await loadAndDesSerializePeerId(protobufData);
    assert.equal(peerId.toString(), peerIdLoaded.toString());
  });
});

describe("CreateLibp2p", () => {
  it("create Libp2p instance without peer id", async () => {
    const node = await createLibp2p(getLibp2pOptions());
    const multiaddrs = node.getMultiaddrs();
    assert.isTrue(multiaddrs.length === 0);
    await node.stop();
  });

  it("create Libp2p instance with peer id", async () => {
    const { peerId } = await generateAndSerializePeerId();
    const node = await createLibp2p(
      getLibp2pOptions({ peerId, listenAddresses: ["/ip4/0.0.0.0/tcp/4001"] }),
    );
    const multiaddrs = node.getMultiaddrs();
    assert.isTrue(multiaddrs.length > 0);
    multiaddrs.forEach((multiaddr) => {
      assert.isTrue(multiaddr.toString().includes(peerId.toString()));
    });
    await node.stop();
  });
});
