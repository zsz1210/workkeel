import crypto from "node:crypto";

export const WORK_ITEM_ID_PATTERN = /^WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10})$/;

export function isWorkItemId(value) {
  return WORK_ITEM_ID_PATTERN.test(value ?? "");
}

export function collaborativeWorkItemId(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `WI-${date}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

export function claimId(now = new Date()) {
  return `claim-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
}

export function runtimeWorkerId(now = new Date()) {
  return `worker-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
}
