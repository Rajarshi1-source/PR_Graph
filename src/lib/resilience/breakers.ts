import type CircuitBreaker from "opossum";
import { makeBreaker } from "./breaker";

/**
 * Shared circuit breakers (plan §13). Each wraps a passthrough thunk so any call to a given
 * dependency shares one breaker: repeated failures open the circuit and fail fast instead of
 * hammering a struggling GitHub/Slack API.
 */
const passthrough = (thunk: () => Promise<unknown>) => thunk();

const globalForBreakers = globalThis as unknown as {
  githubBreaker?: CircuitBreaker<[() => Promise<unknown>], unknown>;
  slackBreaker?: CircuitBreaker<[() => Promise<unknown>], unknown>;
};

const githubBreaker = (globalForBreakers.githubBreaker ??= makeBreaker(passthrough, {
  name: "github",
  timeout: 25_000,
}));

const slackBreaker = (globalForBreakers.slackBreaker ??= makeBreaker(passthrough, {
  name: "slack",
  timeout: 8_000,
  errorThresholdPercentage: 80,
}));

export function fireGithub<T>(thunk: () => Promise<T>): Promise<T> {
  return githubBreaker.fire(thunk as () => Promise<unknown>) as Promise<T>;
}

export function fireSlack<T>(thunk: () => Promise<T>): Promise<T> {
  return slackBreaker.fire(thunk as () => Promise<unknown>) as Promise<T>;
}
