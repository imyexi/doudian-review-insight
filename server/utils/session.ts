import { createHmac, timingSafeEqual } from "node:crypto";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeSignedValue(payload: string, secret: string): string {
  const encodedPayload = toBase64Url(payload);
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedValue(token: string, secret: string): string | null {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const providedSignature = Buffer.from(signature);
  const expectedSignature = Buffer.from(sign(encodedPayload, secret));

  if (providedSignature.length !== expectedSignature.length) {
    return null;
  }

  const isValid = timingSafeEqual(providedSignature, expectedSignature);

  if (!isValid) {
    return null;
  }

  return Buffer.from(encodedPayload, "base64url").toString("utf8");
}
