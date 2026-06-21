import client from "prom-client";

/**
 * Prometheus metrics registry (plan §16). Guarded as a singleton so hot-reload / multiple
 * imports don't double-register collectors.
 */
const globalForMetrics = globalThis as unknown as { register?: client.Registry };

export const register = globalForMetrics.register ?? new client.Registry();

if (!globalForMetrics.register) {
  client.collectDefaultMetrics({ register });
  globalForMetrics.register = register;
}

function counter(cfg: client.CounterConfiguration<string>): client.Counter<string> {
  return (register.getSingleMetric(cfg.name) as client.Counter<string>) ?? new client.Counter({ ...cfg, registers: [register] });
}
function histogram(cfg: client.HistogramConfiguration<string>): client.Histogram<string> {
  return (register.getSingleMetric(cfg.name) as client.Histogram<string>) ?? new client.Histogram({ ...cfg, registers: [register] });
}
function gauge(cfg: client.GaugeConfiguration<string>): client.Gauge<string> {
  return (register.getSingleMetric(cfg.name) as client.Gauge<string>) ?? new client.Gauge({ ...cfg, registers: [register] });
}

export const webhooksReceived = counter({
  name: "prgraph_webhooks_received_total",
  help: "GitHub webhooks accepted (post-verification)",
  labelNames: ["event"],
});

export const graphRecomputes = counter({
  name: "prgraph_graph_recomputes_total",
  help: "Graph recomputations",
  labelNames: ["trigger"],
});

export const recomputeDuration = histogram({
  name: "prgraph_recompute_duration_ms",
  help: "Graph recompute (pure engine) duration in ms",
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

/** Webhook end-to-end latency: from GitHub delivery (received) to recompute completion. */
export const webhookLatency = histogram({
  name: "prgraph_webhook_e2e_latency_ms",
  help: "Webhook received → graph recompute complete, in ms",
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

/** Remaining GitHub REST quota per installation (governor visibility). */
export const githubQuotaRemaining = gauge({
  name: "prgraph_github_quota_remaining",
  help: "Remaining GitHub REST quota for an installation",
  labelNames: ["installation"],
});

/** Installations currently connected (provisioning visibility). */
export const installationsTotal = counter({
  name: "prgraph_installations_total",
  help: "GitHub App installation lifecycle events",
  labelNames: ["action"],
});

/** Depth of the dead-letter stream (messages that exhausted retries). */
export const dlqDepth = gauge({
  name: "prgraph_dlq_depth",
  help: "Number of entries in the webhook dead-letter queue",
});
