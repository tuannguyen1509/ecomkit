import { Injectable } from "@nestjs/common";
import type { LazadaOAuthStateContext } from "@ecomkit/marketplace-server";
import { MarketplaceOAuthStateStore } from "./marketplace-oauth-state.store.js";

@Injectable()
export class LazadaOAuthStateStore extends MarketplaceOAuthStateStore<LazadaOAuthStateContext> {
  constructor() { super("LAZADA"); }
}
