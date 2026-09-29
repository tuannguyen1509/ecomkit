import { strict as assert } from "node:assert";
import { decodeShopeeSyncCheckpoint, encodeShopeeSyncCheckpoint, resolveShopeeIncrementalOverlapSeconds, resolveShopeeSyncWindow, SHOPEE_INCREMENTAL_OVERLAP_DEFAULT_SECONDS, ShopeeSyncCheckpointError } from "./shopee-sync-checkpoint.js";

const checkpoint = encodeShopeeSyncCheckpoint(1_700_000_000);
assert.deepEqual(decodeShopeeSyncCheckpoint(checkpoint), { v: 1, updatedThrough: 1_700_000_000 });
for (const value of ["not-json", '{"v":2,"updatedThrough":1}', '{"v":1}', '{"v":1,"updatedThrough":"1"}', '{"v":1,"updatedThrough":-1}']) assert.throws(() => decodeShopeeSyncCheckpoint(value), ShopeeSyncCheckpointError);
assert.equal(resolveShopeeIncrementalOverlapSeconds(), SHOPEE_INCREMENTAL_OVERLAP_DEFAULT_SECONDS);
assert.equal(resolveShopeeIncrementalOverlapSeconds("120"), 120);
for (const value of ["-1", "1.5", "3601"]) assert.throws(() => resolveShopeeIncrementalOverlapSeconds(value), ShopeeSyncCheckpointError);
const start = new Date(10_000 * 1000); const end = new Date(20_000 * 1000);
const initial = resolveShopeeSyncWindow({ syncType: "INITIAL", windowStart: start, windowEnd: end });
assert.deepEqual(initial, { timeRangeField: "create_time", timeFrom: 10_000, timeTo: 20_000, candidateCheckpoint: encodeShopeeSyncCheckpoint(20_000) });
const incremental = resolveShopeeSyncWindow({ syncType: "INCREMENTAL", windowEnd: end, committedCheckpoint: encodeShopeeSyncCheckpoint(10_000), overlapSeconds: 300 });
assert.deepEqual(incremental, { timeRangeField: "update_time", timeFrom: 9_700, timeTo: 20_000, candidateCheckpoint: encodeShopeeSyncCheckpoint(20_000) });
assert.throws(() => resolveShopeeSyncWindow({ syncType: "INCREMENTAL", windowEnd: end }), (error: unknown) => error instanceof ShopeeSyncCheckpointError && error.code === "SHOPEE_INCREMENTAL_CHECKPOINT_REQUIRED");
assert.throws(() => resolveShopeeSyncWindow({ syncType: "INITIAL", windowEnd: end }), ShopeeSyncCheckpointError);
console.log("Shopee sync checkpoint tests passed");
