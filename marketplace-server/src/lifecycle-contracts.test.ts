import { MarketplaceLifecycleError } from "./lifecycle-contracts.js";
const secret = "TEST_ACCESS_TOKEN_SECRET";
const retryable = new MarketplaceLifecycleError("SHOPEE_REFRESH_LOCK_UNAVAILABLE", true, "request-1");
const terminal = new MarketplaceLifecycleError("SHOPEE_REAUTH_REQUIRED", false);
if (retryable.toJSON() && JSON.stringify(retryable).includes(secret)) throw new Error("secret leaked");
if (!retryable.retryable || terminal.retryable || (retryable.toJSON() as { requestId?: string }).requestId !== "request-1") throw new Error("contract error regression");
console.log("marketplace lifecycle contract tests passed");
