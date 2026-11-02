type ProviderMetric = {
  source: string;
  barcode: string;
  success: boolean;
  responseTimeMs: number;
  error?: string;
}

class ProviderAnalytics {
  private static instance: ProviderAnalytics;
  private metrics: ProviderMetric[] = [];

  private constructor() {}

  public static getInstance(): ProviderAnalytics {
    if (!ProviderAnalytics.instance) {
      ProviderAnalytics.instance = new ProviderAnalytics();
    }
    return ProviderAnalytics.instance;
  }

  public logMetric(metric: ProviderMetric) {
    this.metrics.push(metric);
    
    const statusIcon = metric.success ? '✓' : '✗';
    console.log(
      `[Analytics] ${metric.source.padEnd(15)} | Barcode: ${metric.barcode} | Status: ${statusIcon} | Time: ${metric.responseTimeMs}ms` +
      (metric.error ? ` | Error: ${metric.error}` : '')
    );
  }

  public getSummary() {
    const totalCalls = this.metrics.length;
    if (totalCalls === 0) return { totalCalls: 0 };

    const bySource = this.metrics.reduce((acc, curr) => {
      if (!acc[curr.source]) {
        acc[curr.source] = { calls: 0, successes: 0, totalTime: 0 };
      }
      acc[curr.source].calls++;
      if (curr.success) acc[curr.source].successes++;
      acc[curr.source].totalTime += curr.responseTimeMs;
      return acc;
    }, {} as Record<string, { calls: number; successes: number; totalTime: number }>);

    return {
      totalCalls,
      breakdown: Object.entries(bySource).map(([source, data]) => ({
        source,
        successRate: `${((data.successes / data.calls) * 100).toFixed(1)}%`,
        avgResponseTime: `${Math.round(data.totalTime / data.calls)}ms`,
      })),
    };
  }
}

export const providerAnalytics = ProviderAnalytics.getInstance();