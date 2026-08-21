const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

const connectDatabase = async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGODB_URI (or MONGO_URI) is not defined in environment variables');
    }

    await mongoose.connect(uri);

    logger.info('MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = { connectDatabase };
