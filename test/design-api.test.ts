import { describe, it, expect } from "vitest";
import { executeInSandbox } from "../src/sandbox/executor.js";

// ---------------------------------------------------------------------------
// These tests exercise the designApi helper in child-runner.js by running
// model + attack code through the sandbox executor in design mode.
// ---------------------------------------------------------------------------

const sampleModelCode = `
// A minimal model for testing the designApi
const assumptions = [
  { id: "A1", text: "Only admin can create items", specRef: "R1", confidence: "high", kind: "inferred_rule", relatedRules: ["R1"] }
];

function initState() {
  return { items: [], nextId: 1 };
}

const handlers = {
  "POST /v1/items": function(state, request) {
    // R1: only admin can create
    if (request.callerRole !== "admin") {
      return { nextState: state, response: { status: 403, error: "forbidden", rejected: true } };
    }
    var id = "item-" + state.nextId;
    var item = { id: id, name: request.name, status: "active" };
    return {
      nextState: { items: state.items.concat([item]), nextId: state.nextId + 1 },
      response: { status: 201, id: id, name: request.name }
    };
  },
  "GET /v1/items": function(state, request) {
    return { nextState: state, response: { status: 200, items: state.items } };
  }
};

const invariants = [
  {
    id: "INV1",
    description: "All items must have active status",
    sourceRule: "R1",
    check: function(state) {
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].status !== "active") {
          return { holds: false, violation: "Item " + state.items[i].id + " is not active" };
        }
      }
      return { holds: true };
    }
  }
];`;

describe("designApi sandbox integration", () => {
  it("runs a basic attack sequence and returns trace", async () => {
    const attackCode = `
async function adversarialSequence(api) {
  api.reset();
  api.annotate("Create an item as admin");
  var resp = api.request("POST /v1/items", { callerRole: "admin", name: "test-item" });
  api.expectAllowed(resp, "Admin should be able to create items");
  api.assertInvariant("INV1");
  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: sampleModelCode,
    });

    expect(result.success).toBe(true);
    const attackResult = result.result as unknown as {
      trace: unknown[];
      invariantFailures: unknown[];
      annotations: string[];
      totalSteps: number;
    };
    expect(attackResult).toBeDefined();
    expect(attackResult.trace.length).toBeGreaterThan(0);
    expect(attackResult.totalSteps).toBeGreaterThan(0);
    expect(attackResult.invariantFailures.length).toBe(0);
  }, 30_000);

  it("detects authorization bypass via expectRejected", async () => {
    const attackCode = `
async function adversarialSequence(api) {
  api.reset();
  api.annotate("Non-admin tries to create item — should be rejected");
  var resp = api.request("POST /v1/items", { callerRole: "user", name: "sneaky" });
  var check = api.expectRejected(resp, "Non-admin should be rejected");
  api.assertInvariant("INV1");
  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: sampleModelCode,
    });

    expect(result.success).toBe(true);
    const attackResult = result.result as unknown as {
      trace: unknown[];
      invariantFailures: unknown[];
      totalSteps: number;
    };
    expect(attackResult.invariantFailures.length).toBe(0);
  }, 30_000);

  it("handles unknown handler gracefully", async () => {
    const attackCode = `
async function adversarialSequence(api) {
  api.reset();
  var resp = api.request("DELETE /v1/items/1", { callerRole: "admin" });
  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: sampleModelCode,
    });

    expect(result.success).toBe(true);
    const attackResult = result.result as unknown as {
      trace: Array<{ type: string; error?: string }>;
    };
    const unknownEntry = attackResult.trace.find((t) => t.type === "unknown_handler");
    expect(unknownEntry).toBeDefined();
  }, 30_000);

  it("detects invariant violations", async () => {
    // Use a model that has a buggy handler allowing invalid state
    const buggyModel = `
const assumptions = [];

function initState() {
  return { items: [], nextId: 1 };
}

const handlers = {
  "POST /v1/items": function(state, request) {
    // Bug: allows creation with invalid status
    var id = "item-" + state.nextId;
    var item = { id: id, name: request.name, status: request.status || "active" };
    return {
      nextState: { items: state.items.concat([item]), nextId: state.nextId + 1 },
      response: { status: 201, id: id }
    };
  }
};

const invariants = [
  {
    id: "INV1",
    description: "All items must have active status",
    sourceRule: "R1",
    check: function(state) {
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].status !== "active") {
          return { holds: false, violation: "Item " + state.items[i].id + " has status: " + state.items[i].status };
        }
      }
      return { holds: true };
    }
  }
];`;

    const attackCode = `
async function adversarialSequence(api) {
  api.reset();
  api.annotate("Creating item with invalid status to break INV1");
  api.request("POST /v1/items", { callerRole: "admin", name: "bad-item", status: "deleted" });
  var invResult = api.assertInvariant("INV1");
  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: buggyModel,
    });

    expect(result.success).toBe(true);
    const attackResult = result.result as unknown as {
      trace: unknown[];
      invariantFailures: Array<{ id: string; holds: boolean; violation?: string }>;
    };
    // Should have invariant failures from either the auto-check or the explicit assertInvariant
    expect(attackResult.invariantFailures.length).toBeGreaterThan(0);
    expect(attackResult.invariantFailures[0].id).toBe("INV1");
    expect(attackResult.invariantFailures[0].holds).toBe(false);
  }, 30_000);

  it("supports multiple sequences via multiple resets", async () => {
    const attackCode = `
async function adversarialSequence(api) {
  // Sequence 1
  api.reset();
  api.annotate("Sequence 1: create as admin");
  api.request("POST /v1/items", { callerRole: "admin", name: "item1" });

  // Sequence 2
  api.reset();
  api.annotate("Sequence 2: try as user");
  api.request("POST /v1/items", { callerRole: "user", name: "item2" });

  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: sampleModelCode,
    });

    expect(result.success).toBe(true);
    const attackResult = result.result as unknown as {
      annotations: string[];
      totalSteps: number;
    };
    // Reset no longer clears the trace — both sequences' annotations survive
    expect(attackResult.annotations.length).toBe(2);
    expect(attackResult.annotations[0]).toContain("Sequence 1");
    expect(attackResult.annotations[1]).toContain("Sequence 2");
    expect(attackResult.totalSteps).toBeGreaterThan(0);
  }, 30_000);

  it("returns error for malformed model code", async () => {
    const attackCode = `
async function adversarialSequence(api) {
  api.reset();
  return api.finish();
}`;

    const result = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: "this is not valid javascript {{{",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 30_000);
});
