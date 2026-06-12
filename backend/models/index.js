import mongoose from 'mongoose';
import User from './User.js';
import Wallet from './Wallet.js';
import Game from './Game.js';
import Transaction from './Transaction.js';
import Bet from './Bet.js';

/**
 * Database initialization and model exports
 * This file connects to MongoDB and exports all models
 */

export const connectDatabase = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo-game';

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ MongoDB connected successfully');

    // Create indexes
    await createIndexes();

    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

export const disconnectDatabase = async () => {
  try {
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected');
  } catch (error) {
    console.error('❌ MongoDB disconnection failed:', error.message);
  }
};

// Create all indexes
const createIndexes = async () => {
  try {
    await Promise.all([
      User.collection.createIndex({ telegramId: 1 }),
      User.collection.createIndex({ email: 1 }),
      Wallet.collection.createIndex({ userId: 1 }),
      Game.collection.createIndex({ gameId: 1 }),
      Game.collection.createIndex({ status: 1, createdAt: -1 }),
      Transaction.collection.createIndex({ userId: 1, createdAt: -1 }),
      Transaction.collection.createIndex({ status: 1 }),
      Bet.collection.createIndex({ gameId: 1, userId: 1 }),
      Bet.collection.createIndex({ status: 1 }),
    ]);
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('⚠️ Index creation warning:', error.message);
  }
};

// Export all models
export { User, Wallet, Game, Transaction, Bet };

// Export connection status
export const getConnectionStatus = () => mongoose.connection.readyState;

// 0 = disconnected
// 1 = connected
// 2 = connecting
// 3 = disconnecting
