import express from 'express';
import { User, Wallet, Transaction } from '../models/index.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS, TRANSACTION_TYPE, TRANSACTION_STATUS, PAYMENT_CONFIG } from '../config/constants.js';
import { initiateDeposit, checkDepositStatus, initiateWithdrawal, checkWithdrawalStatus, verifyWebhookSignature } from '../config/telebirr-api.js';
import { generateTransactionId, validateBetAmount, normalizePhoneNumber } from '../utils/helpers.js';

const router = express.Router();

/**
 * POST /wallet/balance
 * Get current wallet balance
 */
router.get('/balance', verifyAuthToken, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.userId });

    if (!wallet) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.WALLET_FROZEN,
        message: 'Wallet not found',
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      wallet: {
        balance: wallet.balance,
        lockedBalance: wallet.lockedBalance,
        availableBalance: wallet.availableBalance,
        currency: wallet.currency,
        status: wallet.status,
        totalDeposited: wallet.totalDeposited,
        totalWithdrawn: wallet.totalWithdrawn,
        totalWon: wallet.totalWon,
        totalLost: wallet.totalLost,
      },
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * POST /wallet/deposit
 * Initiate deposit via TeleBirr
 * Body: { amount, phoneNumber }
 */
router.post('/deposit', verifyAuthToken, async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body;

    // Validate amount
    const validation = validateBetAmount(amount, PAYMENT_CONFIG.MIN_DEPOSIT, 1000000);
    if (!validation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_AMOUNT,
        message: validation.error,
      });
    }

    // Validate phone
    if (!phoneNumber) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Phone number required',
      });
    }

    const user = await User.findById(req.user.userId);
    const wallet = await Wallet.findOne({ userId: req.user.userId });

    // Check wallet status
    if (wallet.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: ERROR_CODES.WALLET_FROZEN,
        message: 'Wallet is frozen or suspended',
      });
    }

    // Initiate TeleBirr deposit
    const telebirrResponse = await initiateDeposit(
      req.user.userId,
      amount,
      normalizePhoneNumber(phoneNumber)
    );

    if (!telebirrResponse.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.TELEBIRR_ERROR,
        message: 'Failed to initiate deposit',
        details: telebirrResponse.error,
      });
    }

    // Create transaction record
    const transactionId = generateTransactionId();
    await Transaction.create({
      transactionId,
      userId: req.user.userId,
      type: TRANSACTION_TYPE.DEPOSIT,
      amount,
      currency: 'ETB',
      status: TRANSACTION_STATUS.PENDING,
      teleBirrTransactionId: telebirrResponse.transactionId,
      teleBirrPhoneNumber: normalizePhoneNumber(phoneNumber),
      balanceBeforeTransaction: wallet.balance,
      balanceAfterTransaction: wallet.balance, // Will be updated on callback
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Deposit initiated',
      transaction: {
        transactionId,
        amount,
        status: TRANSACTION_STATUS.PENDING,
        paymentUrl: telebirrResponse.paymentUrl,
      },
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * POST /wallet/withdrawal
 * Initiate withdrawal to TeleBirr
 * Body: { amount, phoneNumber }
 */
router.post('/withdrawal', verifyAuthToken, async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body;

    // Validate amount
    const validation = validateBetAmount(amount, PAYMENT_CONFIG.MIN_WITHDRAWAL, 1000000);
    if (!validation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_AMOUNT,
        message: validation.error,
      });
    }

    if (!phoneNumber) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Phone number required',
      });
    }

    const wallet = await Wallet.findOne({ userId: req.user.userId });

    // Check balance
    if (wallet.availableBalance < amount) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INSUFFICIENT_BALANCE,
        message: `Insufficient balance. Available: ${wallet.availableBalance} ETB`,
      });
    }

    // Check daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyWithdrawals = await Transaction.aggregate([
      {
        $match: {
          userId: req.user.userId,
          type: TRANSACTION_TYPE.WITHDRAWAL,
          status: TRANSACTION_STATUS.COMPLETED,
          createdAt: { $gte: today },
        },
      },
      {
        $group: { _id: null, total: { $sum: '$amount' } },
      },
    ]);

    const dailyAmount = dailyWithdrawals[0]?.total || 0;
    if (dailyAmount + amount > PAYMENT_CONFIG.MAX_WITHDRAWAL_PER_DAY) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'WITHDRAWAL_LIMIT_EXCEEDED',
        message: `Daily withdrawal limit exceeded. Limit: ${PAYMENT_CONFIG.MAX_WITHDRAWAL_PER_DAY} ETB`,
      });
    }

    // Initiate TeleBirr withdrawal
    const telebirrResponse = await initiateWithdrawal(
      req.user.userId,
      amount,
      normalizePhoneNumber(phoneNumber)
    );

    if (!telebirrResponse.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.TELEBIRR_ERROR,
        message: 'Failed to initiate withdrawal',
        details: telebirrResponse.error,
      });
    }

    // Lock balance
    wallet.lockedBalance += amount;
    wallet.availableBalance = wallet.balance - wallet.lockedBalance;
    await wallet.save();

    // Create transaction record
    const transactionId = generateTransactionId();
    await Transaction.create({
      transactionId,
      userId: req.user.userId,
      type: TRANSACTION_TYPE.WITHDRAWAL,
      amount,
      currency: 'ETB',
      status: TRANSACTION_STATUS.PROCESSING,
      teleBirrTransactionId: telebirrResponse.transactionId,
      teleBirrPhoneNumber: normalizePhoneNumber(phoneNumber),
      balanceBeforeTransaction: wallet.balance,
      balanceAfterTransaction: wallet.balance - amount,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Withdrawal initiated',
      transaction: {
        transactionId,
        amount,
        status: TRANSACTION_STATUS.PROCESSING,
        estimatedTime: telebirrResponse.estimatedTime,
      },
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * GET /wallet/transactions
 * Get transaction history
 */
router.get('/transactions', verifyAuthToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments({ userId: req.user.userId });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * POST /wallet/deposit-callback
 * TeleBirr webhook for deposit completion
 */
router.post('/deposit-callback', async (req, res) => {
  try {
    const { signature, ...payload } = req.body;

    // Verify webhook signature
    if (!verifyWebhookSignature(payload, signature)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: 'INVALID_SIGNATURE',
      });
    }

    const { transactionId, status, amount } = payload;

    // Update transaction
    const transaction = await Transaction.findOne({
      teleBirrTransactionId: transactionId,
    });

    if (!transaction) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: 'TRANSACTION_NOT_FOUND',
      });
    }

    if (status === 'completed') {
      transaction.status = TRANSACTION_STATUS.COMPLETED;
      transaction.completedAt = new Date();

      // Update wallet
      const wallet = await Wallet.findOne({ userId: transaction.userId });
      wallet.balance += transaction.amount;
      wallet.availableBalance = wallet.balance - wallet.lockedBalance;
      wallet.totalDeposited += transaction.amount;
      wallet.lastBalanceUpdateAt = new Date();

      await Promise.all([transaction.save(), wallet.save()]);
    } else if (status === 'failed') {
      transaction.status = TRANSACTION_STATUS.FAILED;
      transaction.failureReason = payload.reason || 'Payment failed';
      await transaction.save();
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Webhook processed',
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

/**
 * POST /wallet/withdrawal-callback
 * TeleBirr webhook for withdrawal completion
 */
router.post('/withdrawal-callback', async (req, res) => {
  try {
    const { signature, ...payload } = req.body;

    // Verify webhook signature
    if (!verifyWebhookSignature(payload, signature)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: 'INVALID_SIGNATURE',
      });
    }

    const { transactionId, status } = payload;

    // Update transaction
    const transaction = await Transaction.findOne({
      teleBirrTransactionId: transactionId,
    });

    if (!transaction) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: 'TRANSACTION_NOT_FOUND',
      });
    }

    const wallet = await Wallet.findOne({ userId: transaction.userId });

    if (status === 'completed') {
      transaction.status = TRANSACTION_STATUS.COMPLETED;
      transaction.completedAt = new Date();

      // Update wallet
      wallet.balance -= transaction.amount;
      wallet.lockedBalance -= transaction.amount;
      wallet.availableBalance = wallet.balance - wallet.lockedBalance;
      wallet.totalWithdrawn += transaction.amount;
      wallet.lastWithdrawalAt = new Date();
      wallet.lastBalanceUpdateAt = new Date();

      await Promise.all([transaction.save(), wallet.save()]);
    } else if (status === 'failed') {
      transaction.status = TRANSACTION_STATUS.FAILED;
      transaction.failureReason = payload.reason || 'Withdrawal failed';

      // Unlock balance on failure
      wallet.lockedBalance -= transaction.amount;
      wallet.availableBalance = wallet.balance - wallet.lockedBalance;

      await Promise.all([transaction.save(), wallet.save()]);
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Webhook processed',
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

export default router;
