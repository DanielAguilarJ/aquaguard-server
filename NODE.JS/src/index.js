const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { Client, Databases, ID } = require('node-appwrite');
require('dotenv').config();

// Logger (usar util común)
const logger = require('./utils/logger');

// Appwrite client configuration
const client = new Client();
if (process.env.APPWRITE_ENDPOINT) client.setEndpoint(process.env.APPWRITE_ENDPOINT);
if (process.env.APPWRITE_PROJECT_ID) client.setProject(process.env.APPWRITE_PROJECT_ID);
if (process.env.APPWRITE_API_KEY) client.setKey(process.env.APPWRITE_API_KEY);
const databases = new Databases(client);

// Express app setup
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  }
}));

// Rate limiting (configurable via env)
const rateWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`); // 15m
const rateMaxReq = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000');
const ingestWindowMs = parseInt(process.env.INGEST_RATE_LIMIT_WINDOW_MS || `${60 * 1000}`); // 1m
const ingestMaxReq = parseInt(process.env.INGEST_RATE_LIMIT_MAX_REQUESTS || '300');

const limiter = rateLimit({
  windowMs: rateWindowMs,
  max: rateMaxReq,
  message: { error: 'Too many requests from this IP, please try again later.' }
});

const ingestLimiter = rateLimit({
  windowMs: ingestWindowMs,
  max: ingestMaxReq,
  message: { error: 'Rate limit exceeded for telemetry ingestion.' }
});

app.use(limiter);
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000']).map(o => o.trim()),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Utilidades
const allowedSensorTypes = [
  'flow',
  'pressure',
  'temperature',
  'humidity',
  'ph',
  'turbidity',
  'dissolvedOxygen',
  'conductivity'
];

const getUnit = (type) => {
  const units = {
    flow: 'L/min',
    pressure: 'bar',
    temperature: '°C',
    humidity: '%',
    ph: 'pH',
    turbidity: 'NTU',
    dissolvedOxygen: 'mg/L',
    conductivity: 'μS/cm'
  };
  return units[type] || 'unit';
};

// Telemetry payload validation schema (camelCase)
const telemetrySchema = Joi.object({
  deviceId: Joi.string().required().min(1).max(100),
  sensorType: Joi.string().valid(...allowedSensorTypes).required(),
  value: Joi.number().required().min(-1000).max(10000),
  unit: Joi.string().optional(),
  timestamp: Joi.alternatives().try(
    Joi.string().isoDate(),
    Joi.number().positive()
  ).optional(),
  location: Joi.string().optional(),
  metadata: Joi.object().optional()
});

const bulkTelemetrySchema = Joi.object({
  readings: Joi.array().items(telemetrySchema).min(1).max(100).required()
});

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required', code: 'MISSING_TOKEN' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      logger.warn('Invalid token attempt', { ip: req.ip, userAgent: req.get('User-Agent'), error: err.message });
      return res.status(403).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    }

    req.deviceId = decoded.deviceId;
    req.tokenExp = decoded.exp;
    next();
  });
};

// Generate token endpoint (for ESP8266 devices)
app.post('/auth/token', async (req, res) => {
  try {
    const { deviceId, deviceSecret } = req.body || {};

    if (!deviceId || !deviceSecret) {
      return res.status(400).json({ error: 'Device ID and secret are required', code: 'MISSING_CREDENTIALS' });
    }

    const expectedSecret = (process.env.DEVICE_SECRET_PREFIX || '') + deviceId;
    if (deviceSecret !== expectedSecret) {
      logger.warn('Invalid device credentials', { deviceId, ip: req.ip });
      return res.status(401).json({ error: 'Invalid device credentials', code: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign(
      { deviceId, type: 'device', iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    logger.info('Token generated for device', { deviceId, ip: req.ip });

    res.json({ token, expiresIn: 60 * 15, tokenType: 'Bearer' });
  } catch (error) {
    logger.error('Token generation error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Internal server error', code: 'TOKEN_GENERATION_ERROR' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Single telemetry ingestion endpoint (camelCase fields)
app.post('/ingest', ingestLimiter, authenticateToken, async (req, res) => {
  try {
    const { error, value } = telemetrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Invalid telemetry data', details: error.details.map(d => d.message), code: 'VALIDATION_ERROR' });
    }

    if (value.deviceId !== req.deviceId) {
      return res.status(403).json({ error: 'Device ID mismatch', code: 'DEVICE_ID_MISMATCH' });
    }

    let timestamp = value.timestamp;
    if (typeof timestamp === 'number') {
      timestamp = new Date(timestamp * 1000).toISOString();
    } else if (!timestamp) {
      timestamp = new Date().toISOString();
    }

    const unit = value.unit || getUnit(value.sensorType);
    const location = value.location || 'unknown';

    const document = await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_SENSOR_READINGS_COLLECTION_ID,
      ID.unique(),
      {
        deviceId: value.deviceId,
        sensorType: value.sensorType,
        value: value.value,
        unit,
        timestamp,
        location,
        isAnomalous: false,
        ingestedAt: new Date().toISOString(),
        metadata: value.metadata || {}
      }
    );

    logger.info('Telemetry stored', { deviceId: value.deviceId, sensorType: value.sensorType, documentId: document.$id });

    res.status(201).json({ success: true, documentId: document.$id, timestamp });
  } catch (error) {
    logger.error('Telemetry ingestion error', { error: error.message, stack: error.stack, deviceId: req.deviceId });

    if (error.code === 401) {
      res.status(500).json({ error: 'Database authentication failed', code: 'DB_AUTH_ERROR' });
    } else if (error.code === 404) {
      res.status(500).json({ error: 'Database or collection not found', code: 'DB_NOT_FOUND' });
    } else {
      res.status(500).json({ error: 'Internal server error', code: 'INGESTION_ERROR' });
    }
  }
});

// Bulk telemetry ingestion endpoint (camelCase fields)
app.post('/ingest/bulk', ingestLimiter, authenticateToken, async (req, res) => {
  try {
    const { error, value } = bulkTelemetrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Invalid bulk telemetry data', details: error.details.map(d => d.message), code: 'VALIDATION_ERROR' });
    }

    const results = [];
    const errors = [];

    for (const reading of value.readings) {
      try {
        if (reading.deviceId !== req.deviceId) {
          errors.push({ reading, error: 'Device ID mismatch' });
          continue;
        }

        let timestamp = reading.timestamp;
        if (typeof timestamp === 'number') {
          timestamp = new Date(timestamp * 1000).toISOString();
        } else if (!timestamp) {
          timestamp = new Date().toISOString();
        }

        const unit = reading.unit || getUnit(reading.sensorType);
        const location = reading.location || 'unknown';

        const document = await databases.createDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_SENSOR_READINGS_COLLECTION_ID,
          ID.unique(),
          {
            deviceId: reading.deviceId,
            sensorType: reading.sensorType,
            value: reading.value,
            unit,
            timestamp,
            location,
            isAnomalous: false,
            ingestedAt: new Date().toISOString(),
            metadata: reading.metadata || {}
          }
        );

        results.push({ documentId: document.$id, timestamp, sensorType: reading.sensorType });
      } catch (err) {
        errors.push({ reading, error: err.message });
      }
    }

    logger.info('Bulk telemetry processed', { deviceId: req.deviceId, successful: results.length, failed: errors.length });

    res.status(201).json({ success: true, processed: results.length, failed: errors.length, results, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    logger.error('Bulk telemetry ingestion error', { error: error.message, stack: error.stack, deviceId: req.deviceId });
    res.status(500).json({ error: 'Internal server error', code: 'BULK_INGESTION_ERROR' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', { error: error.message, stack: error.stack, url: req.url, method: req.method });
  res.status(500).json({ error: 'Internal server error', code: 'UNHANDLED_ERROR' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`AquaGuard Telemetry Gateway started on port ${PORT}`);
    console.log(`AquaGuard Telemetry Gateway running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
