/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { createManagementDomain } from "./runtime-actions.test-fixtures.ts";

describe("runtime action duplicate identities", () => {
  it("rejects registering one canonical action under two membership keys", () => {
    const { appDomain } = createManagementDomain();

    const registerDuplicate = () =>
      appDomain.withActions({
        createTaskAlias: appDomain.actions.createTask,
      });

    expect(registerDuplicate).toThrow(
      "Duplicate domain action id: management.createTask",
    );
  });
});
