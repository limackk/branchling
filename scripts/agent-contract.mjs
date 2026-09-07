/** The small versioned seam shared by profiles, preflight and adapters (TL-294). */
import { PRODUCT_NAME as N } from "./product.mjs";

export const ADAPTER_PROTOCOL_VERSION = 1;
/**
 * A local, core-authored record of one adapter attempt. Providers are never
 * trusted to mark their own request as confirmed: `confirmed` starts null and
 * may only be filled by a future core parser of provider-produced evidence.
 */
export const EXECUTION_RECEIPT_VERSION = 1;
export const DELEGATION_POLICIES = ["provider", "branchling", "hybrid"]; // product-name: allow — delegation vocabulary
export const DELEGATION_ENFORCEMENT = ["enforced", "requested", "unsupported"];

const receiptValue = (value) => {
  const text = String(value || "").trim();
  return text || null;
};

/** Build the stable, credential-free shape persisted in local activity data. */
export function executionReceipt({ profile, adapterFingerprint, task, role, attempt, model, effort, delegation = "provider", delegationEnforcement = "requested" }) {
  return {
    version: EXECUTION_RECEIPT_VERSION,
    provider: null,
    profile: receiptValue(profile),
    adapter: { fingerprint: receiptValue(adapterFingerprint) },
    task: receiptValue(task),
    role: receiptValue(role) || "",
    attempt: Number(attempt),
    requested: { model: receiptValue(model), effort: receiptValue(effort) },
    delegation: { requested: delegation, enforcement: delegationEnforcement },
    // Distinct from `requested`: null means no provider-produced evidence was
    // available, never that the requested value was accepted.
    confirmed: { model: null, effort: null },
  };
}

const PREFIX = String(N).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const PROFILE_PROBE_ENV = PREFIX + "_PROFILE_PROBE";
export const PROFILE_PROTOCOL_VERSION_ENV = PREFIX + "_PROFILE_PROTOCOL_VERSION";
export const PROFILE_PROBE_OUTCOMES = ["ready", "unavailable", "authentication-refused", "quota-refused"];
/** Explicit model discovery: never set by setup or an ordinary profile check. */
export const MODEL_CATALOG_ENV = PREFIX + "_MODEL_CATALOG";
export const MODEL_CATALOG_OUTCOMES = ["listed", "unavailable", "not-verifiable"];
