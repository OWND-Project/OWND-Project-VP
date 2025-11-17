import { assert, expect } from "chai";
import { v4 as uuidv4 } from "uuid";
import {
  initPostStateRepository,
  initSessionRepository,
  PostStateRepository,
  SessionRepository,
} from "../../src/usecases/oid4vp-repository.js";
import { clearDir, generateTemporaryPath } from "../test-utils.js";
import { initOrbitdb4Verifier } from "../../src/api.js";
import { KeyValueType } from "../../src/usecases/oid4vp-interactor.js";
import { getCurrentUnixTimeInSeconds } from "../../src/utils/data-util.js";
import { PostState } from "../../src/usecases/types.js";
import { faker } from "@faker-js/faker";
import { KeyValues, Node, OpenedKeyValue } from "../../src/orbit-db/index.js";

describe("Repository", () => {
  let node: Node | null = null;
  let openedKeyValues: KeyValues | null = null;

  beforeEach(async () => {
    await clearDir();
    process.env.OID4VP_IPFS_PATH = generateTemporaryPath("ipfs", "blocks");
    process.env.OID4VP_ORBITDB_PATH = generateTemporaryPath("orbitdb");
    process.env.OID4VP_KEYSTORE_PATH = generateTemporaryPath("keystore");

    const { node: __node, openedKeyValues: __openedKeyValues } =
      await initOrbitdb4Verifier();
    node = __node;
    openedKeyValues = __openedKeyValues;
  });

  afterEach(async () => {
    if (openedKeyValues) {
      openedKeyValues.closeKeyValues;
    }
    if (node) {
      await node.close();
    }
  });

  describe("#SessionRepository", () => {
    let sessionKeyValue: OpenedKeyValue | null = null;
    let sessionRepository: SessionRepository;
    beforeEach(async () => {
      if (!openedKeyValues) {
        assert.fail("openedKeyValues should be got");
      }

      sessionKeyValue = openedKeyValues.keyValues[KeyValueType.sessions.name];
      sessionRepository = initSessionRepository(sessionKeyValue);
    });
    describe("#putRequestId", () => {
      it("should create a session and store it in the database", async () => {
        if (!sessionKeyValue) {
          assert.fail("keyValue should be got");
        }
        // prepare test data
        const requestId = "test-request-id";
        const expiredIn = 3600;
        const data = { requestId };

        // execute
        const session = await sessionRepository.putRequestId(requestId, {
          expiredIn,
        });

        const issuedAt = getCurrentUnixTimeInSeconds();
        const expectedSession = {
          id: session.id,
          data,
          issuedAt,
          expiredIn,
        };

        // assert
        const savedSession = await sessionKeyValue.db.get(expectedSession.id);
        expect(savedSession).to.deep.equal(expectedSession);
        expect(session).to.deep.equal(expectedSession);
      });
    });
    describe("#putWaitCommitData", () => {
      it("should create a session and store it in the database", async () => {
        if (!sessionKeyValue) {
          assert.fail("keyValue should be got");
        }
        // prepare test data
        const requestId = faker.string.uuid();
        const idToken = faker.string.alpha(10);
        const claimJwt = faker.string.alpha(10);
        const data = { idToken, claimJwt };
        const expiredIn = 3600;

        // execute
        const session = await sessionRepository.putWaitCommitData(
          requestId,
          idToken,
          claimJwt,
          undefined,
          { expiredIn },
        );

        const issuedAt = getCurrentUnixTimeInSeconds();
        const expectedSession = {
          id: session.id,
          data,
          issuedAt,
          expiredIn,
        };

        // assert
        const savedSession = await sessionKeyValue.db.get(expectedSession.id);
        expect(savedSession).to.deep.equal(expectedSession);
        expect(session).to.deep.equal(expectedSession);
      });
    });

    describe("#getSession", () => {
      it("should retrieve a session from the database", async () => {
        if (!sessionKeyValue) {
          assert.fail("keyValue should be got");
        }
        // prepare test data
        const sessionId = uuidv4();
        const requestId = "test-request-id";
        const data = { requestId };
        const session = {
          id: sessionId,
          data,
          issuedAt: getCurrentUnixTimeInSeconds(),
          expiredIn: 3600,
        };
        await sessionKeyValue.db.put(sessionId, session);

        // execute
        const result = await sessionRepository.getSession(sessionId);

        // assert
        if (!result.ok) {
          assert.fail("session was not found");
        }
        expect(result.payload).to.deep.equal(session);
      });
    });
  });
  describe("#PostStateRepository", () => {
    let postStateKeyValue: OpenedKeyValue | null = null;
    let postStateRepository: PostStateRepository;
    beforeEach(async () => {
      if (!openedKeyValues) {
        assert.fail("openedKeyValues should be got");
      }
      postStateKeyValue = openedKeyValues.keyValues[KeyValueType.states.name];
      postStateRepository = initPostStateRepository(postStateKeyValue);
    });

    describe("#putState", () => {
      it("should create a state and store it in the database", async () => {
        if (!postStateKeyValue) {
          assert.fail("postStateKeyValue should be got");
        }
        // prepare test data
        const requestId = "test-request-id";
        const expiredIn = 3600;

        // execute
        const state = await postStateRepository.putState(requestId, "started", {
          expiredIn,
        });

        const expectedState: PostState = {
          id: state.id,
          value: "started",
          issuedAt: state.issuedAt,
          expiredIn: state.expiredIn,
        };

        // assert
        const savedState = await postStateKeyValue?.db.get(requestId);
        expect(savedState).to.deep.equal(expectedState);

        // update
        await postStateRepository.putState(requestId, "committed");
        const expectedState2: PostState = {
          id: state.id,
          value: "committed",
          issuedAt: state.issuedAt, // keep this value
          expiredIn: state.expiredIn, // keep this value
        };
        const savedState2 = await postStateKeyValue?.db.get(requestId);
        expect(savedState2).to.deep.equal(expectedState2);
      });
      it("should create a state with target id and store it in the database", async () => {
        if (!postStateKeyValue) {
          assert.fail("postStateKeyValue should be got");
        }
        // prepare test data
        const requestId = "test-request-id";
        const expiredIn = 3600;

        // execute
        const state = await postStateRepository.putState(requestId, "started", {
          targetId: faker.string.uuid(),
          expiredIn,
        });

        const issuedAt = getCurrentUnixTimeInSeconds();
        const expectedState: PostState = {
          id: state.id,
          value: "started",
          targetId: state.targetId,
          issuedAt,
          expiredIn,
        };

        // assert
        const savedState = await postStateKeyValue?.db.get(requestId);
        expect(savedState).to.deep.equal(expectedState);
      });
    });

    describe("#getState", () => {
      it("should retrieve a state from the database", async () => {
        if (!postStateKeyValue) {
          assert.fail("postStateKeyValue should be got");
        }
        // prepare test data
        const requestId = "test-request-id";
        const state: PostState = {
          id: requestId,
          value: "started",
          issuedAt: getCurrentUnixTimeInSeconds(),
          expiredIn: 3600,
        };
        await postStateKeyValue.db.put(requestId, state);

        // execute
        const result = await postStateRepository.getState(requestId);

        // assert
        expect(result).to.deep.equal(state);
      });
      it('should update the state to "expired" if the state has expired', async () => {
        if (!postStateKeyValue) {
          assert.fail("postStateKeyValue should be got");
        }
        // prepare test data
        const requestId = "test-request-id";
        const expiredState: PostState = {
          id: requestId,
          value: "started",
          issuedAt: getCurrentUnixTimeInSeconds() - 700, // already expired time
          expiredIn: 600,
        };
        await postStateKeyValue.db.put(requestId, expiredState);

        // execute
        const result = await postStateRepository.getState(requestId);

        const expectedState = {
          ...expiredState,
          value: "expired",
        };

        const updatedState = await postStateKeyValue.db.get(requestId);
        expect(updatedState).to.deep.equal(expectedState);
        expect(result).to.deep.equal(expectedState);
      });
    });
  });
});
