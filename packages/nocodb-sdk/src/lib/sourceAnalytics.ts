export interface SourceAnalyticsTotals {
  count: number;
  errors: number;
  slow: number;
  avgMs: number;
  maxMs: number;
  errorRate: number;
}

export interface SourceAnalyticsResponse {
  enabled: boolean;
  supported: boolean;
  sourceEnabled: boolean;
  metrics: null | {
    startedAt: number;
    from: number;
    to: number;
    summary: SourceAnalyticsTotals & {
      p95UpperMs: number | null;
      p95Overflow: boolean;
    };
    series: (SourceAnalyticsTotals & {
      timestamp: number;
      observed: boolean;
    })[];
    queries: (SourceAnalyticsTotals & {
      queryId: string;
      operation: string;
      totalMs: number;
    })[];
    inFlight: number;
    dropped: number;
  };
  pool: null | { used: number; free: number; pending: number };
  health: null | {
    status: 'available' | 'unavailable' | 'unsupported';
    checkedAt: number;
    storageBytes?: number;
    connections?: number;
    activeConnections?: number;
    tables: {
      name: string;
      estimatedRows: number;
      deadRows?: number;
      bytes: number;
      lastAnalyze?: string;
    }[];
  };
}
