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
