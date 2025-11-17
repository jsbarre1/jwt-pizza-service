const config = require('./config.js');

class Logger {
  constructor() {
    this.config = config.logging;
  }

  // Sanitize sensitive data from logs
  sanitize(data) {
    if (!data) return data;

    // Create a deep copy to avoid mutating the original
    const sanitized = JSON.parse(JSON.stringify(data));

    // Fields that should be sanitized
    const sensitiveFields = ['password', 'token', 'apiKey', 'jwtSecret', 'authorization'];

    const sanitizeObject = (obj) => {
      if (typeof obj !== 'object' || obj === null) return;

      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  // Send log event to Grafana Loki
  sendLogToGrafana(level, type, message, details = {}) {
    try {
      // Sanitize the details
      const sanitizedDetails = this.sanitize(details);

      // Build Loki log entry
      const logEntry = {
        streams: [
          {
            stream: {
              source: this.config.source,
              level: level,
              type: type,
            },
            values: [
              [
                String(Date.now() * 1000000), // Nanosecond timestamp
                JSON.stringify({
                  message: message,
                  ...sanitizedDetails,
                }),
              ],
            ],
          },
        ],
      };

      const body = JSON.stringify(logEntry);

      // Split userId and apiKey from the config.apiKey
      const [userId, apiKey] = this.config.apiKey.split(':');

      fetch(this.config.url, {
        method: 'post',
        body: body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userId}:${apiKey}`,
        },
      })
        .then((res) => {
          if (!res.ok) {
            console.error('Failed to send log to Grafana:', res.statusText);
          }
        })
        .catch((err) => {
          console.error('Error sending log to Grafana:', err.message);
        });
    } catch (error) {
      console.error('Error in sendLogToGrafana:', error.message);
    }
  }

  // HTTP request/response logging middleware
  httpLogger = (req, res, next) => {
    const startTime = Date.now();

    // Capture request details
    const requestDetails = {
      method: req.method,
      path: req.path,
      hasAuthorization: !!req.headers.authorization,
      requestBody: req.body,
    };

    // Capture the original res.json and res.send to log response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let responseBody;

    res.json = function (body) {
      responseBody = body;
      return originalJson(body);
    };

    res.send = function (body) {
      if (!responseBody) {
        responseBody = body;
      }
      return originalSend(body);
    };

    // Log when response finishes
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      this.sendLogToGrafana('info', 'http', 'HTTP Request', {
        method: requestDetails.method,
        path: requestDetails.path,
        statusCode: res.statusCode,
        hasAuthorization: requestDetails.hasAuthorization,
        requestBody: requestDetails.requestBody,
        responseBody: responseBody,
        durationMs: duration,
      });
    });

    next();
  };

  // Database query logging
  logDBQuery(sql, params) {
    this.sendLogToGrafana('info', 'database', 'Database Query', {
      sql: sql,
      params: params,
    });
  }

  // Factory service request logging
  logFactoryRequest(requestBody, responseBody, statusCode, error = null) {
    const level = error ? 'error' : 'info';
    this.sendLogToGrafana(level, 'factory', 'Factory Service Request', {
      requestBody: requestBody,
      responseBody: responseBody,
      statusCode: statusCode,
      error: error,
    });
  }

  // Unhandled exception logging
  logException(error, context = {}) {
    this.sendLogToGrafana('error', 'exception', 'Unhandled Exception', {
      errorMessage: error.message,
      errorStack: error.stack,
      ...context,
    });
  }

  // General purpose logging
  log(level, type, message, details = {}) {
    this.sendLogToGrafana(level, type, message, details);
  }
}

const logger = new Logger();
module.exports = logger;
