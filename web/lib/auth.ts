import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * Validates HMAC SHA-256 signature from worker ingestion headers.
 * Header format: X-Signature-SHA256: sha256=<hex_digest>
 */
export function verifyHmacSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.DRIFT_HMAC_SECRET || "super-secret-hmac-key";

  if (!signatureHeader) {
    // In local development, allow without signature if secret is default or development flag set
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_INGEST === "true") {
      return true;
    }
    return false;
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("hex");

  const providedSig = signatureHeader.replace(/^sha256=/, "").trim();

  try {
    const expectedBuf = Buffer.from(expectedSig, "hex");
    const providedBuf = Buffer.from(providedSig, "hex");

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch (err) {
    console.error("HMAC verification error:", err);
    return false;
  }
}

/**
 * Verifies request authorization for administrative / retraining actions.
 */
export function verifyAdminAuth(req: NextRequest): boolean {
  // Check authorization header
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.ADMIN_API_KEY || process.env.DRIFT_HMAC_SECRET || "super-secret-hmac-key";

  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === expectedSecret) {
      return true;
    }
  }

  // Allow same-origin requests in browser
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  if (origin && origin.includes(host)) {
    return true;
  }

  // Development convenience
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return false;
}
