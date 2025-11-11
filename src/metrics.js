const os = require('os');
const config = require('./config.js');

class OtelMetricsBuilder {
  constructor(source) {
    this.source = source;
    this.metrics = [];
  }

  addMetric(metricName, metricValue, unit = '', attributes = {}) {
    const allAttributes = [
      { key: 'source', value: { stringValue: this.source } },
      ...Object.entries(attributes).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) }
      }))
    ];

    const metric = {
      name: metricName,
      unit: unit,
      gauge: {
        dataPoints: [
          {
            asDouble: Number(metricValue),
            timeUnixNano: String(Date.now() * 1000000),
            attributes: allAttributes
          }
        ]
      }
    };

    this.metrics.push(metric);
  }

  toOtelFormat() {
    return {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: this.metrics
            }
          ]
        }
      ]
    };
  }

  clear() {
    this.metrics = [];
  }
}

class Metrics {
  constructor(config = {}) {
    this.config = config;
    this.source = config.source || 'jwt-pizza-service';

    this.httpMetrics = {
      requests: new Map(), 
      totalRequests: 0,
      activeRequests: 0,
      errors: 0,
    };

    this.authMetrics = {
      successful: 0,
      failed: 0,
    };

    this.userMetrics = {
      newUsers: 0,
      activeUsers: new Set(),
    };

    this.purchaseMetrics = {
      attempts: 0,
      successful: 0,
      failed: 0,
      totalRevenue: 0,
      pizzasSold: 0,
      latencies: [],
      failureLatencies: [],
    };

    this.systemMetrics = {};

    if (this.config.url && this.config.apiKey) {
      this.startPeriodicReporting();
    }
  }

  requestTracker = (req, res, next) => {
    const startTime = Date.now();
    this.httpMetrics.totalRequests++;
    this.httpMetrics.activeRequests++;

    const key = `${req.method}:${req.path}`;
    const existing = this.httpMetrics.requests.get(key) || { count: 0, totalTime: 0 };
    this.httpMetrics.requests.set(key, existing);

    const originalEnd = res.end;
    res.end = (...args) => {
      const duration = Date.now() - startTime;

      existing.count++;
      existing.totalTime += duration;
      this.httpMetrics.activeRequests--;

      if (res.statusCode >= 400) {
        this.httpMetrics.errors++;
      }

      originalEnd.apply(res, args);
    };

    next();
  };

  trackAuth(success, userId = null) {
    if (success) {
      this.authMetrics.successful++;
      if (userId) {
        this.userMetrics.activeUsers.add(userId);
      }
    } else {
      this.authMetrics.failed++;
    }
  }

  trackNewUser(userId) {
    this.userMetrics.newUsers++;
    this.userMetrics.activeUsers.add(userId);
  }

  pizzaPurchase(success, latencyMs, pizzaCount = 0, revenue = 0) {
    this.purchaseMetrics.attempts++;

    if (success) {
      this.purchaseMetrics.successful++;
      this.purchaseMetrics.pizzasSold += pizzaCount;
      this.purchaseMetrics.totalRevenue += revenue;
      this.purchaseMetrics.latencies.push(latencyMs);
    } else {
      this.purchaseMetrics.failed++;
      this.purchaseMetrics.failureLatencies.push(latencyMs);
    }
  }

  getCpuUsagePercentage() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return (cpuUsage * 100).toFixed(2);
  }

  getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    return memoryUsage.toFixed(2);
  }

  collectMetrics() {
    const builder = new OtelMetricsBuilder(this.source);

    // HTTP Request Metrics
    builder.addMetric('http_requests_total', this.httpMetrics.totalRequests, 'requests');
    builder.addMetric('http_requests_active', this.httpMetrics.activeRequests, 'requests');
    builder.addMetric('http_requests_errors_total', this.httpMetrics.errors, 'requests');

    // Per-endpoint metrics
    for (const [endpoint, data] of this.httpMetrics.requests.entries()) {
      const [method, path] = endpoint.split(':');
      const avgLatency = data.count > 0 ? (data.totalTime / data.count).toFixed(2) : 0;

      builder.addMetric('http_request_count_total', data.count, 'requests', { method, path });
      builder.addMetric('http_request_duration_ms', avgLatency, 'ms', { method, path });
    }

    // Authentication Metrics
    builder.addMetric('auth_attempts_total', this.authMetrics.successful, 'attempts', { status: 'success' });
    builder.addMetric('auth_attempts_total', this.authMetrics.failed, 'attempts', { status: 'fail' });

    // User Metrics
    builder.addMetric('user_registrations_total', this.userMetrics.newUsers, 'users');
    builder.addMetric('user_active_total', this.userMetrics.activeUsers.size, 'users');

    // Purchase Metrics
    builder.addMetric('pizza_purchase_attempts_total', this.purchaseMetrics.attempts, 'purchases');
    builder.addMetric('pizza_purchase_total', this.purchaseMetrics.successful, 'purchases', { status: 'success' });
    builder.addMetric('pizza_purchase_total', this.purchaseMetrics.failed, 'purchases', { status: 'fail' });
    builder.addMetric('pizza_revenue_total', this.purchaseMetrics.totalRevenue.toFixed(2), 'USD');
    builder.addMetric('pizza_sold_total', this.purchaseMetrics.pizzasSold, 'pizzas');

    // Purchase latency metrics
    for (const latency of this.purchaseMetrics.latencies) {
      builder.addMetric('pizza_purchase_duration_ms', latency, 'ms', { status: 'success' });
    }
    this.purchaseMetrics.latencies = [];

    for (const latency of this.purchaseMetrics.failureLatencies) {
      builder.addMetric('pizza_purchase_duration_ms', latency, 'ms', { status: 'fail' });
    }
    this.purchaseMetrics.failureLatencies = [];

    // System Metrics
    builder.addMetric('system_cpu_usage_percent', this.getCpuUsagePercentage(), '%');
    builder.addMetric('system_memory_usage_percent', this.getMemoryUsagePercentage(), '%');

    return builder.toOtelFormat();
  }

  async sendMetricsToGrafana() {
    if (!this.config.url || !this.config.apiKey) {
      console.log('Metrics not configured - skipping send');
      return;
    }

    const metricsData = this.collectMetrics();

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(this.config.apiKey).toString('base64')}`,
        },
        body: JSON.stringify(metricsData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to send metrics to Grafana:', response.status, response.statusText, errorText);
        console.error('Request body sample:', JSON.stringify(metricsData).substring(0, 500));
      } else {
        console.log('✓ Metrics sent successfully');
      }
    } catch (error) {
      console.error('Error sending metrics to Grafana:', error);
    }
  }

  startPeriodicReporting(intervalMs = 10000) {
    this.reportingInterval = setInterval(async () => {
      try {
        await this.sendMetricsToGrafana();
      } catch (error) {
        console.error('Error in periodic metrics reporting:', error);
      }
    }, intervalMs);
  }

  stopPeriodicReporting() {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }
  }
}

const metrics = new Metrics(config.metrics);

module.exports = metrics;
