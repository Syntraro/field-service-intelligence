/**
 * Communications provider registry — Phase 5 (2026-05-08).
 *
 * Resolves a `CommunicationProviderId` discriminator to the concrete
 * adapter. Mirrors the shape of `paymentProviderResolver` in the
 * payments domain — keeping the surfaces parallel makes future
 * cross-domain refactors cheap.
 *
 * Currently registered:
 *   - twilio
 *
 * Future (telnyx, bandwidth) plug in here. The discriminator union in
 * `./types.ts > CommunicationProviderId` already lists them so the
 * compile-time exhaustiveness check at the bottom of this file
 * surfaces missing registrations as type errors.
 */

import type {
  CommunicationProviderId,
  CommunicationsProvider,
} from "./types";
import { twilioProvider } from "./twilioProvider";

const registry: Record<CommunicationProviderId, CommunicationsProvider | null> = {
  twilio: twilioProvider,
  telnyx: null,
  bandwidth: null,
};

/**
 * Resolve a registered provider adapter by id. Throws if the id is
 * recognized by the union but no adapter is registered yet (so missing
 * coverage shows up as a clear runtime error, not a silent `undefined`).
 */
export function resolveProvider(id: CommunicationProviderId): CommunicationsProvider {
  const adapter = registry[id];
  if (!adapter) {
    throw new Error(`No registered communications provider for id: ${id}`);
  }
  return adapter;
}

/**
 * String-typed entrypoint for routes — the path param arrives as a raw
 * string, and we want to reject unknown values with a clean 400 rather
 * than a TS-cast surprise. Returns `null` for unknown ids; the route
 * is responsible for the HTTP response shape.
 */
export function resolveProviderByString(
  raw: string,
): CommunicationsProvider | null {
  if (!isCommunicationProviderId(raw)) return null;
  const adapter = registry[raw];
  return adapter ?? null;
}

export function isCommunicationProviderId(
  raw: string,
): raw is CommunicationProviderId {
  return raw === "twilio" || raw === "telnyx" || raw === "bandwidth";
}

/**
 * Compile-time exhaustiveness check — adding a new provider id to the
 * union without registering an entry above triggers a TS error here.
 */
const _exhaustive: Record<CommunicationProviderId, unknown> = registry;
void _exhaustive;
