/** The small versioned seam shared by profiles, preflight and adapters (TL-294). */
import { PRODUCT_NAME as N } from "./product.mjs";

export const ADAPTER_PROTOCOL_VERSION = 1;
const PREFIX = String(N).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const PROFILE_PROBE_ENV = PREFIX + "_PROFILE_PROBE";
export const PROFILE_PROTOCOL_VERSION_ENV = PREFIX + "_PROFILE_PROTOCOL_VERSION";
export const PROFILE_PROBE_OUTCOMES = ["ready", "unavailable", "authentication-refused", "quota-refused"];
/** Explicit model discovery: never set by setup or an ordinary profile check. */
export const MODEL_CATALOG_ENV = PREFIX + "_MODEL_CATALOG";
export const MODEL_CATALOG_OUTCOMES = ["listed", "unavailable", "not-verifiable"];
