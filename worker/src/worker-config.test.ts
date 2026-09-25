import assert from "node:assert/strict";
import { requireWorkerInternalApiKey } from "./worker-config.js";

const prior = process.env.WORKER_INTERNAL_API_KEY;
try {
  delete process.env.WORKER_INTERNAL_API_KEY;
  assert.throws(() => requireWorkerInternalApiKey(), /WORKER_INTERNAL_API_KEY is required/);
  process.env.WORKER_INTERNAL_API_KEY = "technical-worker-key";
  assert.equal(requireWorkerInternalApiKey(), "technical-worker-key");
  console.log("worker internal auth configuration test passed");
} finally {
  if (prior === undefined) delete process.env.WORKER_INTERNAL_API_KEY;
  else process.env.WORKER_INTERNAL_API_KEY = prior;
}
