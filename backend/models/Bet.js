import mongoose from 'mongoose';

/**
 * Bet Schema
 * Tracks individual player bets in each game
 */
const betSchema = new mongoose.Schema(
  {
    // Bet Identification
    betId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // References
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Game',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Bet Amount
    betAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: 'ETB',
    },

    // Status
    status: {
      type: String,
      enum: ['active', 'won', 'lost', 'refunded', 'cancelled'],
      default: 'active',
      index: true,
    },

    // Results
    winAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lossAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    netAmount: {
      type: Number,
      default: 0,
    },

    // House Commission from this bet
    houseCommissionFromBet: {
      type: Number,
      default: 0,
    },

    // Game Position (final)
    finalPosition: Number, // 1st, 2nd, 3rd, 4th

    // Timestamps
    placedAt: {
      type: Date,
      default: Date.now,
    },
    resultedAt: Date,

    // Outcome Calculation
    participantCount: Number, // How many players in the game
    oddMultiplier: Number, // Based on participants

    // Transaction Reference
    settlementTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      sparse: true,
    },

    // Metadata
    ipAddress: String,
    deviceInfo: String,
  },
  {
    timestamps: true,
    collection: 'bets',
  }
);

// Indexes
betSchema.index({ gameId: 1, userId: 1 });
betSchema.index({ userId: 1, createdAt: -1 });
betSchema.index({ status: 1 });
betSchema.index({ resultedAt: -1 });

export default mongoose.model('Bet', betSchema);
