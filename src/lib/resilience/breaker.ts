import CircuitBreaker from "opossum";

/**
 * Circuit Breaker (Opossum, plan §13). Wrap an unreliable async action so repeated failures
 * "open" the circuit and fail fast instead of hammering a struggling dependency.
 */
export function makeBreaker<TArgs extends unknown[], TRet>(
  action: (...args: TArgs) => Promise<TRet>,
  options: CircuitBreaker.Options = {},
): CircuitBreaker<TArgs, TRet> {
  return new CircuitBreaker(action, {
    timeout: 10_000,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    ...options,
  });
}
