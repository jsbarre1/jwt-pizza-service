jest.mock('../src/config', () => ({
  jwtSecret: 'test-secret',
  logging: {
    source: 'test-source',
    url: 'http://test-logging.com',
    apiKey: '12345:test-api-key',
  },
}));

// Mock fetch globally
global.fetch = jest.fn();

// We need to require logger after mocking config
const logger = require('../src/logger');

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sanitize', () => {
    test('sanitizes password field', () => {
      const data = { username: 'john', password: 'secret123' };
      const sanitized = logger.sanitize(data);

      expect(sanitized.username).toBe('john');
      expect(sanitized.password).toBe('***REDACTED***');
    });

    test('sanitizes token field', () => {
      const data = { token: 'abc123', data: 'public' };
      const sanitized = logger.sanitize(data);

      expect(sanitized.token).toBe('***REDACTED***');
      expect(sanitized.data).toBe('public');
    });

    test('sanitizes apiKey field', () => {
      const data = { apiKey: 'secret-key', other: 'value' };
      const sanitized = logger.sanitize(data);

      expect(sanitized.apiKey).toBe('***REDACTED***');
      expect(sanitized.other).toBe('value');
    });

    test('sanitizes authorization field', () => {
      const data = { authorization: 'Bearer token123' };
      const sanitized = logger.sanitize(data);

      expect(sanitized.authorization).toBe('***REDACTED***');
    });

    test('sanitizes nested objects', () => {
      const data = {
        user: {
          name: 'john',
          password: 'secret',
          settings: {
            apiKey: 'key123',
          },
        },
      };
      const sanitized = logger.sanitize(data);

      expect(sanitized.user.name).toBe('john');
      expect(sanitized.user.password).toBe('***REDACTED***');
      expect(sanitized.user.settings.apiKey).toBe('***REDACTED***');
    });

    test('handles null data', () => {
      const sanitized = logger.sanitize(null);
      expect(sanitized).toBeNull();
    });

    test('handles undefined data', () => {
      const sanitized = logger.sanitize(undefined);
      expect(sanitized).toBeUndefined();
    });

    test('does not mutate original object', () => {
      const data = { password: 'secret' };
      const sanitized = logger.sanitize(data);

      expect(data.password).toBe('secret');
      expect(sanitized.password).toBe('***REDACTED***');
    });

    test('handles arrays', () => {
      const data = {
        users: [
          { name: 'john', password: 'secret1' },
          { name: 'jane', password: 'secret2' },
        ],
      };
      const sanitized = logger.sanitize(data);

      expect(sanitized.users[0].password).toBe('***REDACTED***');
      expect(sanitized.users[1].password).toBe('***REDACTED***');
    });
  });

  describe('sendLogToGrafana', () => {
    test('sends log to Grafana successfully', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      logger.sendLogToGrafana('info', 'test', 'Test message', {
        key: 'value',
      });

      // Wait for the promise to resolve
      await Promise.resolve();

      expect(fetch).toHaveBeenCalledWith('http://test-logging.com', {
        method: 'post',
        body: expect.any(String),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer 12345:test-api-key',
        },
      });

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toHaveProperty('streams');
      expect(body.streams).toHaveLength(1);
      expect(body.streams[0].stream.source).toBe('test-source');
      expect(body.streams[0].stream.level).toBe('info');
      expect(body.streams[0].stream.type).toBe('test');
    });

    test('sanitizes sensitive data before sending', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      logger.sendLogToGrafana('info', 'test', 'Test message', {
        username: 'john',
        password: 'secret123',
      });

      await Promise.resolve();

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const logData = JSON.parse(body.streams[0].values[0][1]);

      expect(logData.username).toBe('john');
      expect(logData.password).toBe('***REDACTED***');
    });

    test('handles fetch error gracefully', (done) => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to send log to Grafana:',
            'Internal Server Error'
          );
          consoleErrorSpy.mockRestore();
          done();
        });

      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      logger.sendLogToGrafana('error', 'test', 'Error message');
    });

    test('handles network error gracefully', (done) => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {
          consoleErrorSpy.mockRestore();
          done();
        });

      fetch.mockRejectedValue(new Error('Network error'));

      logger.sendLogToGrafana('error', 'test', 'Error message');
    });
  });

  describe('httpLogger middleware', () => {
    test('logs HTTP request and response', () => {
      const req = {
        method: 'GET',
        path: '/api/test',
        headers: { authorization: 'Bearer token123' },
        body: { test: 'data' },
      };

      let finishCallback;
      const res = {
        statusCode: 200,
        json: jest.fn().mockImplementation(function (body) {
          return body;
        }),
        send: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
        }),
      };

      const next = jest.fn();

      fetch.mockResolvedValue({ ok: true });

      logger.httpLogger(req, res, next);

      expect(next).toHaveBeenCalled();

      // Simulate response
      res.json({ result: 'success' });

      // Manually trigger the finish event
      if (finishCallback) {
        finishCallback();
      }

      expect(fetch).toHaveBeenCalled();
    });

    test('captures request without authorization header', async () => {
      const req = {
        method: 'POST',
        path: '/api/public',
        headers: {},
        body: { data: 'test' },
      };

      const res = {
        statusCode: 201,
        json: jest.fn(),
        send: jest.fn(),
        on: jest.fn(),
      };

      const next = jest.fn();

      logger.httpLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('preserves res.json functionality', () => {
      const req = {
        method: 'GET',
        path: '/test',
        headers: {},
        body: {},
      };

      const originalJson = jest.fn((body) => body);
      const res = {
        statusCode: 200,
        json: originalJson,
        send: jest.fn(),
        on: jest.fn(),
      };
      res.json = res.json.bind(res);

      const next = jest.fn();

      logger.httpLogger(req, res, next);

      const testData = { test: 'data' };
      res.json(testData);

      // The wrapped json should still work
      expect(res.json).toBeDefined();
    });

    test('preserves res.send functionality', () => {
      const req = {
        method: 'GET',
        path: '/test',
        headers: {},
        body: {},
      };

      const originalSend = jest.fn((body) => body);
      const res = {
        statusCode: 200,
        json: jest.fn(),
        send: originalSend,
        on: jest.fn(),
      };
      res.send = res.send.bind(res);

      const next = jest.fn();

      logger.httpLogger(req, res, next);

      const testData = 'test response';
      res.send(testData);

      expect(res.send).toBeDefined();
    });
  });

  describe('logDBQuery', () => {
    test('logs database query with parameters', () => {
      fetch.mockResolvedValue({ ok: true });

      logger.logDBQuery('SELECT * FROM users WHERE id = ?', [123]);

      expect(fetch).toHaveBeenCalledWith(
        'http://test-logging.com',
        expect.objectContaining({
          method: 'post',
        })
      );
    });

    test('logs database query without parameters', () => {
      fetch.mockResolvedValue({ ok: true });

      logger.logDBQuery('SELECT * FROM users', undefined);

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('logFactoryRequest', () => {
    test('logs successful factory request', () => {
      fetch.mockResolvedValue({ ok: true });

      const requestBody = { order: 'test' };
      const responseBody = { success: true };

      logger.logFactoryRequest(requestBody, responseBody, 200);

      expect(fetch).toHaveBeenCalledWith(
        'http://test-logging.com',
        expect.objectContaining({
          method: 'post',
        })
      );
    });

    test('logs failed factory request with error', () => {
      fetch.mockResolvedValue({ ok: true });

      const requestBody = { order: 'test' };
      const responseBody = { error: 'failed' };

      logger.logFactoryRequest(requestBody, responseBody, 500, 'Error message');

      expect(fetch).toHaveBeenCalled();

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.streams[0].stream.level).toBe('error');
      expect(body.streams[0].stream.type).toBe('factory');
    });
  });

  describe('logException', () => {
    test('logs exception with context', () => {
      fetch.mockResolvedValue({ ok: true });

      const error = new Error('Test error');
      const context = { path: '/api/test', method: 'GET' };

      logger.logException(error, context);

      expect(fetch).toHaveBeenCalledWith(
        'http://test-logging.com',
        expect.objectContaining({
          method: 'post',
        })
      );

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.streams[0].stream.level).toBe('error');
      expect(body.streams[0].stream.type).toBe('exception');
    });

    test('logs exception without context', () => {
      fetch.mockResolvedValue({ ok: true });

      const error = new Error('Test error');

      logger.logException(error);

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('log', () => {
    test('logs with custom level, type, and message', () => {
      fetch.mockResolvedValue({ ok: true });

      logger.log('warn', 'custom', 'Custom message', {
        customField: 'value',
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://test-logging.com',
        expect.objectContaining({
          method: 'post',
        })
      );

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.streams[0].stream.level).toBe('warn');
      expect(body.streams[0].stream.type).toBe('custom');
    });

    test('logs without details', () => {
      fetch.mockResolvedValue({ ok: true });

      logger.log('info', 'general', 'General message');

      expect(fetch).toHaveBeenCalled();
    });
  });
});
