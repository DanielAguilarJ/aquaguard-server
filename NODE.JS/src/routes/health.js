const express = require('express');
const router = express.Router();
const { databases, DATABASE_ID } = require('../config/appwrite');

// @desc    Health check endpoint
// @route   GET /health
// @access  Public
router.get('/', async (req, res) => {
  try {
    // Check Appwrite connection
    await databases.list();
    
    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        appwrite: 'connected',
        database: DATABASE_ID
      },
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed',
      services: {
        appwrite: 'disconnected',
        database: 'unavailable'
      }
    });
  }
});

module.exports = router;