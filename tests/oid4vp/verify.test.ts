// This test file has been disabled - all tests were for deprecated PEX verification functions
// that have been removed in favor of DCQL-based VP Token processing.
//
// Deprecated functions that were tested here:
// - extractFromPath
// - getDescriptorMap
// - extractPresentation
// - extractNestedCredential
// - extractCredential
//
// For DCQL-based credential extraction, see:
// - src/usecases/internal/credential2-processor.ts (extractCredentialFromVpToken)
// - tests for extractCredentialFromVpToken in other test files

import { assert } from "chai";

describe.skip("verify.ts - DEPRECATED PEX tests (all skipped)", () => {
  it("All PEX verification tests have been removed", () => {
    assert.ok(true, "PEX verification functions removed - tests no longer applicable");
  });
});
