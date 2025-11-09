const os = require('os');

jest.mock('../src/config', () => ({
  jwtSecret: 'test-secret',
  factory: {
    url: 'http://test-factory.com',
    apiKey: 'test-api-key'
  },
  metrics: {
    source: 'test-source',
    url: 'http://test-metrics.com',
    apiKey: 'test-metrics-key'
  }
}));

// Mock fetch globally
global.fetch = jest.fn();

// We need to require metrics after mocking config
const metrics = require('../src/metrics');

describe('Metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Stop any existing intervals before setting up fake timers
    metrics.stopPeriodicReporting();
    jest.useFakeTimers();

    // Reset all metrics
    metrics.httpMetrics = {
      requests: new Map(),
      totalRequests: 0,
      activeRequests: 0,
      errors: 0,
    };
    metrics.authMetrics = {
      successful: 0,
      failed: 0,
    };
    metrics.userMetrics = {
      newUsers: 0,
      activeUsers: new Set(),
    };
    metrics.purchaseMetrics = {
      attempts: 0,
      successful: 0,
      failed: 0,
      totalRevenue: 0,
      pizzasSold: 0,
      latencies: [],
      failureLatencies: [],
    };
  });

  afterEach(() => {
    // Stop intervals before restoring real timers
    metrics.stopPeriodicReporting();
    jest.useRealTimers();
  });

  afterAll(() => {
    // Final cleanup
    metrics.stopPeriodicReporting();
  });

  describe('requestTracker middleware', () => {
    test('tracks HTTP requests and updates metrics', () => {
      const req = { method: 'GET', path: '/api/test' };
      const res = {
        statusCode: 200,
        end: jest.fn()
      };
      const next = jest.fn();

      const initialTotal = metrics.httpMetrics.totalRequests;
      metrics.requestTracker(req, res, next);

      expect(metrics.httpMetrics.totalRequests).toBe(initialTotal + 1);
      expect(metrics.httpMetrics.activeRequests).toBe(1);
      expect(next).toHaveBeenCalled();

      // Simulate response end
      res.end();

      expect(metrics.httpMetrics.activeRequests).toBe(0);
      expect(metrics.httpMetrics.requests.has('GET:/api/test')).toBe(true);
    });

    test('tracks errors for 4xx responses', () => {
      const req = { method: 'POST', path: '/api/error' };
      const res = {
        statusCode: 400,
        end: jest.fn()
      };
      const next = jest.fn();

      const initialErrors = metrics.httpMetrics.errors;
      metrics.requestTracker(req, res, next);
      res.end();

      expect(metrics.httpMetrics.errors).toBe(initialErrors + 1);
    });

    test('tracks errors for 5xx responses', () => {
      const req = { method: 'POST', path: '/api/server-error' };
      const res = {
        statusCode: 500,
        end: jest.fn()
      };
      const next = jest.fn();

      const initialErrors = metrics.httpMetrics.errors;
      metrics.requestTracker(req, res, next);
      res.end();

      expect(metrics.httpMetrics.errors).toBe(initialErrors + 1);
    });

    test('calculates request duration', () => {
      const req = { method: 'GET', path: '/api/timing' };
      const res = {
        statusCode: 200,
        end: jest.fn()
      };
      const next = jest.fn();

      metrics.requestTracker(req, res, next);

      // Advance time by 100ms
      jest.advanceTimersByTime(100);

      res.end();

      const requestData = metrics.httpMetrics.requests.get('GET:/api/timing');
      expect(requestData.count).toBe(1);
      expect(requestData.totalTime).toBeGreaterThanOrEqual(0);
    });
  });



  describe('trackAuth', () => {
    test('tracks successful authentication with user ID', () => {
      const initialSuccessful = metrics.authMetrics.successful;
      metrics.trackAuth(true, 123);

      expect(metrics.authMetrics.successful).toBe(initialSuccessful + 1);
      expect(metrics.userMetrics.activeUsers.has(123)).toBe(true);
    });

    test('tracks successful authentication without user ID', () => {
      const initialSuccessful = metrics.authMetrics.successful;
      metrics.trackAuth(true);

      expect(metrics.authMetrics.successful).toBe(initialSuccessful + 1);
    });

    test('tracks failed authentication', () => {
      const initialFailed = metrics.authMetrics.failed;
      metrics.trackAuth(false);

      expect(metrics.authMetrics.failed).toBe(initialFailed + 1);
    });
  });

  describe('trackNewUser', () => {
    test('increments new user count and adds to active users', () => {
      const initialNewUsers = metrics.userMetrics.newUsers;
      metrics.trackNewUser(456);

      expect(metrics.userMetrics.newUsers).toBe(initialNewUsers + 1);
      expect(metrics.userMetrics.activeUsers.has(456)).toBe(true);
    });
  });

  describe('pizzaPurchase', () => {
    test('tracks successful pizza purchase', () => {
      const initialAttempts = metrics.purchaseMetrics.attempts;
      const initialSuccessful = metrics.purchaseMetrics.successful;
      const initialRevenue = metrics.purchaseMetrics.totalRevenue;
      const initialPizzas = metrics.purchaseMetrics.pizzasSold;

      metrics.pizzaPurchase(true, 150, 3, 25.99);

      expect(metrics.purchaseMetrics.attempts).toBe(initialAttempts + 1);
      expect(metrics.purchaseMetrics.successful).toBe(initialSuccessful + 1);
      expect(metrics.purchaseMetrics.pizzasSold).toBe(initialPizzas + 3);
      expect(metrics.purchaseMetrics.totalRevenue).toBeCloseTo(initialRevenue + 25.99);
      expect(metrics.purchaseMetrics.latencies).toContain(150);
    });

    test('tracks failed pizza purchase', () => {
      const initialAttempts = metrics.purchaseMetrics.attempts;
      const initialFailed = metrics.purchaseMetrics.failed;

      metrics.pizzaPurchase(false, 200);

      expect(metrics.purchaseMetrics.attempts).toBe(initialAttempts + 1);
      expect(metrics.purchaseMetrics.failed).toBe(initialFailed + 1);
      expect(metrics.purchaseMetrics.failureLatencies).toContain(200);
    });

    test('tracks purchase with default values', () => {
      const initialAttempts = metrics.purchaseMetrics.attempts;
      metrics.pizzaPurchase(true, 100);

      expect(metrics.purchaseMetrics.attempts).toBe(initialAttempts + 1);
      expect(metrics.purchaseMetrics.pizzasSold).toBe(0);
      expect(metrics.purchaseMetrics.totalRevenue).toBe(0);
    });
  });

  describe('getCpuUsagePercentage', () => {
    test('returns CPU usage as percentage', () => {
      jest.spyOn(os, 'loadavg').mockReturnValue([1.5, 1.0, 0.5]);
      jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

      const cpuUsage = metrics.getCpuUsagePercentage();

      expect(cpuUsage).toBe('37.50');
      expect(typeof cpuUsage).toBe('string');
    });
  });

  describe('getMemoryUsagePercentage', () => {
    test('returns memory usage as percentage', () => {
      jest.spyOn(os, 'totalmem').mockReturnValue(16000000000);
      jest.spyOn(os, 'freemem').mockReturnValue(8000000000);

      const memoryUsage = metrics.getMemoryUsagePercentage();

      expect(memoryUsage).toBe('50.00');
      expect(typeof memoryUsage).toBe('string');
    });
  });

  describe('sendMetricsToGrafana', () => {
    test('sends metrics to Grafana successfully', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      metrics.httpMetrics.totalRequests = 5;

      await metrics.sendMetricsToGrafana();

      expect(fetch).toHaveBeenCalledWith('http://test-metrics.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': expect.stringMatching(/^Basic /)
        },
        body: expect.any(String)
      });

      // Verify the body is valid JSON in OTLP format
      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toHaveProperty('resourceMetrics');
      expect(body.resourceMetrics).toHaveLength(1);
      expect(body.resourceMetrics[0]).toHaveProperty('scopeMetrics');
    });

    test('logs error when Grafana request fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Error details')
      });

      await metrics.sendMetricsToGrafana();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to send metrics to Grafana:',
        500,
        'Internal Server Error',
        'Error details'
      );

      consoleErrorSpy.mockRestore();
    });

    test('logs error when fetch throws exception', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const fetchError = new Error('Network error');

      fetch.mockRejectedValue(fetchError);

      await metrics.sendMetricsToGrafana();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error sending metrics to Grafana:',
        fetchError
      );

      consoleErrorSpy.mockRestore();
    });

    test('does not send metrics when config is missing url', async () => {
      const originalUrl = metrics.config.url;
      metrics.config.url = null;

      await metrics.sendMetricsToGrafana();

      expect(fetch).not.toHaveBeenCalled();

      metrics.config.url = originalUrl;
    });

    test('does not send metrics when config is missing apiKey', async () => {
      const originalApiKey = metrics.config.apiKey;
      metrics.config.apiKey = null;

      await metrics.sendMetricsToGrafana();

      expect(fetch).not.toHaveBeenCalled();

      metrics.config.apiKey = originalApiKey;
    });
  });

  describe('periodic reporting', () => {
    test('stops periodic reporting', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      metrics.reportingInterval = 123;
      metrics.stopPeriodicReporting();

      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
      expect(metrics.reportingInterval).toBeNull();
    });

    test('does not error when stopping with no active interval', () => {
      metrics.reportingInterval = null;

      expect(() => metrics.stopPeriodicReporting()).not.toThrow();
    });
  });
});
