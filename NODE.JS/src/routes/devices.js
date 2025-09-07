const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { databases, DATABASE_ID, COLLECTIONS, DEVICE_TYPES } = require('../config/appwrite');
const logger = require('../utils/logger');

// Validation schemas
const deviceRegistrationValidation = [
  body('serialNumber').notEmpty().withMessage('Serial number is required'),
  body('name').notEmpty().withMessage('Device name is required'),
  body('location').notEmpty().withMessage('Location is required'),
  body('macAddress').matches(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).withMessage('Invalid MAC address format'),
  body('deviceType').isIn(Object.values(DEVICE_TYPES)).withMessage('Invalid device type'),
  body('firmwareVersion').notEmpty().withMessage('Firmware version is required')
];

const deviceUpdateValidation = [
  body('name').optional().notEmpty().withMessage('Device name cannot be empty'),
  body('location').optional().notEmpty().withMessage('Location cannot be empty'),
  body('isOnline').optional().isBoolean().withMessage('isOnline must be boolean'),
  body('batteryLevel').optional().isFloat({ min: 0, max: 100 }).withMessage('Battery level must be between 0-100')
];

// @desc    Register a new device
// @route   POST /api/devices/register
// @access  Private
router.post('/register', deviceRegistrationValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { 
      serialNumber, 
      name, 
      location, 
      macAddress, 
      wifiSSID, 
      deviceType, 
      firmwareVersion 
    } = req.body;

    const deviceId = uuidv4();
    const now = new Date().toISOString();

    const deviceData = {
      deviceId,
      serialNumber,
      name,
      location,
      macAddress,
      wifiSSID: wifiSSID || null,
      isOnline: true,
      batteryLevel: null,
      firmwareVersion,
      deviceType,
      createdAt: now,
      lastSeen: now
    };

    // Check if device with same serial number already exists
    try {
      const existingDevices = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.DEVICES,
        [`equal("serialNumber", "${serialNumber}")`]
      );

      if (existingDevices.documents.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Device with this serial number already exists'
        });
      }
    } catch (error) {
      // Continue if query fails - better to allow registration than block it
      logger.warn('Could not check for existing device:', error);
    }

    // Create device in Appwrite
    const result = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      deviceId,
      deviceData
    );

    logger.info(`Device registered: ${deviceId}`, { serialNumber, name, location });

    res.status(201).json({
      success: true,
      message: 'Device registered successfully',
      data: {
        deviceId: result.$id,
        name,
        location,
        serialNumber,
        deviceType,
        createdAt: deviceData.createdAt
      }
    });

  } catch (error) {
    logger.error('Error registering device:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register device',
      error: error.message
    });
  }
});

// @desc    Get all devices
// @route   GET /api/devices
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { location, deviceType, isOnline } = req.query;
    let queries = [];

    if (location) {
      queries.push(`equal("location", "${location}")`);
    }

    if (deviceType) {
      queries.push(`equal("deviceType", "${deviceType}")`);
    }

    if (isOnline !== undefined) {
      queries.push(`equal("isOnline", ${isOnline === 'true'})`);
    }

    queries.push('orderDesc("createdAt")');

    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      queries
    );

    res.status(200).json({
      success: true,
      data: result.documents,
      total: result.total
    });

  } catch (error) {
    logger.error('Error fetching devices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch devices',
      error: error.message
    });
  }
});

// @desc    Get device by ID
// @route   GET /api/devices/:deviceId
// @access  Private
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      deviceId
    );

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    logger.error('Error fetching device:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch device',
      error: error.message
    });
  }
});

// @desc    Update device
// @route   PUT /api/devices/:deviceId
// @access  Private
router.put('/:deviceId', deviceUpdateValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { deviceId } = req.params;
    const updateData = { ...req.body };

    // Always update lastSeen when device is updated
    updateData.lastSeen = new Date().toISOString();

    const result = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      deviceId,
      updateData
    );

    logger.info(`Device updated: ${deviceId}`, updateData);

    res.status(200).json({
      success: true,
      message: 'Device updated successfully',
      data: result
    });

  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    logger.error('Error updating device:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update device',
      error: error.message
    });
  }
});

// @desc    Update device status (for ESP8266 heartbeat)
// @route   POST /api/devices/:deviceId/status
// @access  Private
router.post('/:deviceId/status', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { isOnline, batteryLevel } = req.body;

    const updateData = {
      lastSeen: new Date().toISOString()
    };

    if (typeof isOnline === 'boolean') {
      updateData.isOnline = isOnline;
    }

    if (typeof batteryLevel === 'number' && batteryLevel >= 0 && batteryLevel <= 100) {
      updateData.batteryLevel = batteryLevel;
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      deviceId,
      updateData
    );

    res.status(200).json({
      success: true,
      message: 'Device status updated'
    });

  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    logger.error('Error updating device status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update device status',
      error: error.message
    });
  }
});

// @desc    Delete device
// @route   DELETE /api/devices/:deviceId
// @access  Private
router.delete('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    await databases.deleteDocument(
      DATABASE_ID,
      COLLECTIONS.DEVICES,
      deviceId
    );

    logger.info(`Device deleted: ${deviceId}`);

    res.status(200).json({
      success: true,
      message: 'Device deleted successfully'
    });

  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    logger.error('Error deleting device:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete device',
      error: error.message
    });
  }
});

module.exports = router;