import { Option } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";

/**
 * Small request-extraction helpers shared across every provider's route
 * layer. Every helper here exists because more than one provider needs
 * the same pre-processing (header normalization, bearer-token parsing,
 * pulling the remote address out of an `Option`).
 *
 * Anything provider-specific — body parsing, success-shape building,
 * error-shape building — lives next to that provider, not here.
 */

/**
 * Lower-case + strip parameters from a `Content-Type` header.
 *
 * `Content-Type` is delimited by `;` (e.g. `application/json; charset=utf-8`).
 * Every provider matches on the bare type, so we drop the parameters here
 * once and present a deterministic value.
 */
export function normalizeContentType(value: string | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
}

/**
 * Lower-case a `Content-Encoding` header, returning `null` when absent.
 *
 * `null` is the canonical "no encoding" signal in this codebase — we use
 * it to differentiate "client didn't set the header" from "client set it
 * to an empty string", and to keep the OTLP path's encoding-validation
 * branch cleanly typed.
 */
export function normalizeContentEncoding(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

/**
 * Extract the project slug from an HTTP `Authorization: Bearer <token>`
 * header. Used by providers (e.g. Axiom) that route the project slug
 * through the bearer token instead of the URL path.
 *
 * Returns `null` when the header is missing or doesn't match the bearer
 * scheme — the caller is responsible for turning that into a 401.
 */
export function getProjectSlugFromAuthorization(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Best-effort extraction of the remote client address from the request,
 * collapsing the `Option<string>` shape to a nullable string for the
 * downstream JSON-friendly logging code.
 */
export function getRemoteAddress(
  request: HttpServerRequest.HttpServerRequest,
): string | null {
  return Option.getOrElse(request.remoteAddress, () => null);
}
