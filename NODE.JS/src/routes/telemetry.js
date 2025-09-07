const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { databases, DATABASE_ID, COLLECTIONS, SENSOR_TYPES } = require('../config/appwrite');
const logger = require('../utils/logger');

// Validation schemas
const sensorReadingValidation = [
  body('deviceId').notEmpty().withMessage('Device ID is required'),
  body('sensorType').isIn(Object.values(SENSOR_TYPES)).withMessage('Invalid sensor type'),
  body('value').isNumeric().withMessage('Value must be numeric'),
  body('timestamp').optional().isISO8601().withMessage('Invalid timestamp format'),
  body('location').notEmpty().withMessage('Location is required')
];

const bulkReadingsValidation = [
  body('deviceId').notEmpty().withMessage('Device ID is required'),
  body('readings').isArray({ min: 1 }).withMessage('Readings array is required and must not be empty'),
  body('readings.*.sensorType').isIn(Object.values(SENSOR_TYPES)).withMessage('Invalid sensor type'),
  body('readings.*.value').isNumeric().withMessage('Value must be numeric'),
  body('readings.*.timestamp').optional().isISO8601().withMessage('Invalid timestamp format')
];

// @desc    Ingest single sensor reading
// @route   POST /api/telemetry/ingest
// @access  Private (requires device token)
router.post('/ingest', sensorReadingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { deviceId, sensorType, value, timestamp, location } = req.body;
    
    // Get sensor unit based on type
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

    const sensorReading = {
      deviceId,
      sensorType,
      value: parseFloat(value),
      unit: getUnit(sensorType),
      timestamp: timestamp || new Date().toISOString(),
      location,
      isAnomalous: false // Basic implementation - could be enhanced with ML
    };

    // Store in Appwrite
    const result = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.SENSOR_READINGS,
      uuidv4(),
      sensorReading
    );

    logger.info(`Sensor reading stored: ${result.$id}`, { deviceId, sensorType, value });

    res.status(201).json({
      success: true,
      message: 'Sensor reading stored successfully',
      data: {
        id: result.$id,
        deviceId,
        sensorType,
        value,
        timestamp: sensorReading.timestamp
      }
    });

  } catch (error) {
    logger.error('Error storing sensor reading:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to store sensor reading',
      error: error.message
    });
  }
});

// @desc    Ingest multiple sensor readings in bulk
// @route   POST /api/telemetry/ingest/bulk
// @access  Private (requires device token)
router.post('/ingest/bulk', bulkReadingsValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { deviceId, readings, location } = req.body;
    const storedReadings = [];
    const failedReadings = [];

    for (const reading of readings) {
      try {
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

        const sensorReading = {
          deviceId,
          sensorType: reading.sensorType,
          value: parseFloat(reading.value),
          unit: getUnit(reading.sensorType),
          timestamp: reading.timestamp || new Date().toISOString(),
          location: reading.location || location,
          isAnomalous: false
        };

        const result = await databases.createDocument(
          DATABASE_ID,
          COLLECTIONS.SENSOR_READINGS,
          uuidv4(),
          sensorReading
        );

        storedReadings.push({
          id: result.$id,
          sensorType: reading.sensorType,
          value: reading.value
        });

      } catch (error) {
        failedReadings.push({
          sensorType: reading.sensorType,
          value: reading.value,
          error: error.message
        });
      }
    }

    logger.info(`Bulk readings processed: ${storedReadings.length} stored, ${failedReadings.length} failed`, 
                { deviceId, total: readings.length });

    res.status(201).json({
      success: true,
      message: `Processed ${readings.length} readings`,
      data: {
        deviceId,
        stored: storedReadings.length,
        failed: failedReadings.length,
        storedReadings,
        ...(failedReadings.length > 0 && { failedReadings })
      }
    });

  } catch (error) {
    logger.error('Error processing bulk readings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk readings',
      error: error.message
    });
  }
});

// @desc    Get sensor readings for a device
// @route   GET /api/telemetry/readings/:deviceId
// @access  Private
router.get('/readings/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { 
      sensorType, 
      startDate, 
      endDate, 
      limit = 100 
    } = req.query;

    let queries = [`equal("deviceId", "${deviceId}")`];
    
    if (sensorType) {
      queries.push(`equal("sensorType", "${sensorType}")`);
    }
    
    if (startDate) {
      queries.push(`greaterThanEqual("timestamp", "${startDate}")`);
    }
    
    if (endDate) {
      queries.push(`lessThanEqual("timestamp", "${endDate}")`);
    }
    
    queries.push('orderDesc("timestamp")');
    queries.push(`limit(${Math.min(parseInt(limit), 1000)})`);

    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.SENSOR_READINGS,
      queries
    );

    res.status(200).json({
      success: true,
      data: result.documents,
      total: result.total
    });

  } catch (error) {
    logger.error('Error fetching sensor readings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sensor readings',
      error: error.message
    });
  }
});

module.exports = router;