import { describe, expect, it } from "vitest";

import { keeperHubRegistrationSuccessCopy } from "./registration-copy";

describe("KeeperHub registration result copy", () => {
  it("labels clean simulation and policy-state advisory outcomes truthfully", () => {
    expect(keeperHubRegistrationSuccessCopy([
      { simulationMode: "simulated" },
      { simulationMode: "simulated" },
    ])).toBe("Registered 2 workflows after clean KeeperHub static-write simulation.");

    expect(keeperHubRegistrationSuccessCopy([
      { simulationMode: "policy_state_advisory" },
      { simulationMode: "policy_state_advisory" },
    ])).toBe("Registered 2 workflows; KeeperHub’s fixed write currently reverts as expected while the onchain eligibility guard is false, so scheduled execution remains condition-gated.");
  });

  it("reports the idempotent healthy no-op without claiming a new simulation", () => {
    expect(keeperHubRegistrationSuccessCopy([
      { simulationMode: "already_healthy" },
      { simulationMode: "already_healthy" },
    ])).toBe("KeeperHub already has the exact enabled workflow pair; no pair replacement was needed.");
  });
});
