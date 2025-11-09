const os = require('os');
const config = require('./config.js');

class MetricsBuilder {
  constructor(source) {
    this.source = source;
    this.metrics = [];
  }

  addMetric(metricPrefix, metricName, metricValue, attributes = {}) {
    const metric = {
      name: `${metricPrefix},source=${this.source}`,
      value: metricValue,
      timestamp: Date.now(),
    };

    if (metricName) {
      metric.name += `,metric=${metricName}`;
    }

    for (const [key, value] of Object.entries(attributes)) {
      metric.name += `,${key}=${value}`;
    }

    this.metrics.push(metric);
  }

  toString() {
    return this.metrics
      .map((metric) => `${metric.name} ${metric.value} ${metric.timestamp}`)
      .join('\n');
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
    const builder = new MetricsBuilder(this.source);

    builder.addMetric('request', 'total', this.httpMetrics.totalRequests);
    builder.addMetric('request', 'active', this.httpMetrics.activeRequests);
    builder.addMetric('request', 'errors', this.httpMetrics.errors);

    for (const [endpoint, data] of this.httpMetrics.requests.entries()) {
      const [method, path] = endpoint.split(':');
      const avgLatency = data.count > 0 ? (data.totalTime / data.count).toFixed(2) : 0;

      builder.addMetric('request', 'count', data.count, { method, path });
      builder.addMetric('request', 'latency', avgLatency, { method, path });
    }

    builder.addMetric('auth', 'successful', this.authMetrics.successful);
    builder.addMetric('auth', 'failed', this.authMetrics.failed);

    builder.addMetric('user', 'new', this.userMetrics.newUsers);
    builder.addMetric('user', 'active', this.userMetrics.activeUsers.size);

    builder.addMetric('purchase', 'attempts', this.purchaseMetrics.attempts);
    builder.addMetric('purchase', 'successful', this.purchaseMetrics.successful);
    builder.addMetric('purchase', 'failed', this.purchaseMetrics.failed);
    builder.addMetric('purchase', 'revenue', this.purchaseMetrics.totalRevenue.toFixed(2));
    builder.addMetric('purchase', 'pizzas', this.purchaseMetrics.pizzasSold);

    if (this.purchaseMetrics.latencies.length > 0) {
      const avgLatency = this.purchaseMetrics.latencies.reduce((a, b) => a + b, 0) / this.purchaseMetrics.latencies.length;
      builder.addMetric('purchase', 'latency', avgLatency.toFixed(2), { type: 'success' });
    }

    if (this.purchaseMetrics.failureLatencies.length > 0) {
      const avgFailureLatency = this.purchaseMetrics.failureLatencies.reduce((a, b) => a + b, 0) / this.purchaseMetrics.failureLatencies.length;
      builder.addMetric('purchase', 'latency', avgFailureLatency.toFixed(2), { type: 'failure' });
    }

    builder.addMetric('system', 'cpu', this.getCpuUsagePercentage());
    builder.addMetric('system', 'memory', this.getMemoryUsagePercentage());

    return builder.toString();
  }

  async sendMetricsToGrafana() {
    if (!this.config.url || !this.config.apiKey) {
      return;
    }

    const metricsData = this.collectMetrics();

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: metricsData,
      });

      if (!response.ok) {
        console.error('Failed to send metrics to Grafana:', response.status, response.statusText);
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
