const { Client, Databases, Account } = require('node-appwrite');
const logger = require('../utils/logger');

// Initialize Appwrite client
const client = new Client();

client
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

// Initialize services
const databases = new Databases(client);
const account = new Account(client);

// Database and collection IDs (matching your Swift code)
const DATABASE_ID = 'aquaguard_db';
const COLLECTIONS = {
  DEVICES: 'devices',
  SENSOR_READINGS: 'sensor_readings',
  ALERTS: 'alerts',
  LEAK_PREDICTIONS: 'leak_predictions'
};

// Sensor types (matching your Swift enums)
const SENSOR_TYPES = {
  FLOW: 'flow',
  PRESSURE: 'pressure',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  PH: 'ph',
  TURBIDITY: 'turbidity',
  DISSOLVED_OXYGEN: 'dissolvedOxygen',
  CONDUCTIVITY: 'conductivity'
};

// Device types
const DEVICE_TYPES = {
  AQUAGUARD_SENSOR: 'aquaGuardSensor',
  ESP8266_BASIC: 'esp8266Basic',
  ESP8266_ADVANCED: 'esp8266Advanced'
};

// Helper function to handle Appwrite errors
const handleAppwriteError = (error) => {
  logger.error('Appwrite error:', error);
  
  if (error.code === 404) {
    return { success: false, message: 'Document not found', statusCode: 404 };
  }
  
  if (error.code === 401) {
    return { success: false, message: 'Unauthorized', statusCode: 401 };
  }
  
  if (error.code === 409) {
    return { success: false, message: 'Document already exists', statusCode: 409 };
  }
  
  return { 
    success: false, 
    message: error.message || 'Internal server error', 
    statusCode: 500 
  };
};

module.exports = {
  client,
  databases,
  account,
  DATABASE_ID,
  COLLECTIONS,
  SENSOR_TYPES,
  DEVICE_TYPES,
  handleAppwriteError
};