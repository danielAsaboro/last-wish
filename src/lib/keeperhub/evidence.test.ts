import { describe, expect, it } from "vitest";

import * as evidenceModule from "./evidence";

describe("KeeperHub evidence discovery", () => {
  it("counts only server-discovered current registrations", () => {
    const countCurrentWorkflowRegistrations = (evidenceModule as {
      countCurrentWorkflowRegistrations?: (workflows: Array<{ registrationState: "current" | "stale" }>) => number;
    }).countCurrentWorkflowRegistrations;
    expect(countCurrentWorkflowRegistrations).toEqual(expect.any(Function));
    if (!countCurrentWorkflowRegistrations) return;
    expect(countCurrentWorkflowRegistrations([
      { registrationState: "current" },
      { registrationState: "stale" },
      { registrationState: "current" },
    ])).toBe(2);
  });
});
