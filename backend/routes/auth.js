import express from 'express';
import { User, Wallet } from '../models/index.js';
import { generateToken, parseTelegramInitData } from '../config/auth.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS, USER_STATUS } from '../config/constants.js';
import { isValidEthiopianPhone, normalizePhoneNumber } from '../utils/helpers.js';

const router = express.Router();

/**
 * POST /auth/telegram
 * Telegram login/signup
 * Body: { telegramData }
 */
router.post('/telegram', async (req, res) => {
  try {
    const { telegramData } = req.body;

    if (!telegramData) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Telegram data required',
      });
    }

    // Parse Telegram data
    const telegramUser = parseTelegramInitData(telegramData);

    if (!telegramUser || !telegramUser.user.id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid Telegram data',
      });
    }

    // Check if user exists
    let user = await User.findOne({ telegramId: telegramUser.user.id });

    if (!user) {
      // Create new user
      user = await User.create({
        telegramId: telegramUser.user.id,
        telegramUsername: telegramUser.user.username,
        firstName: telegramUser.user.first_name,
        lastName: telegramUser.user.last_name,
        photoUrl: telegramUser.user.photo_url,
        status: USER_STATUS.ACTIVE,
        lastLoginAt: new Date(),
      });

      // Create wallet for new user
      await Wallet.create({
        userId: user._id,
        balance: 0,
        currency: 'ETB',
      });
    } else {
      // Update last login
      user.lastLoginAt = new Date();
      user.lastActivityAt = new Date();
      await user.save();
    }

    // Check account status
    if (user.status === USER_STATUS.BANNED) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: ERROR_CODES.USER_BANNED,
        message: 'Your account has been banned',
      });
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: ERROR_CODES.USER_SUSPENDED,
        message: 'Your account is suspended',
      });
    }

    // Generate token
    const token = generateToken(user._id, user.telegramId);

    // Get wallet info
    const wallet = await Wallet.findOne({ userId: user._id });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: user ? 'Login successful' : 'Account created',
      token,
      user: {
        id: user._id,
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.telegramUsername,
        photoUrl: user.photoUrl,
        status: user.status,
        kycLevel: user.kycLevel,
      },
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * GET /auth/profile
 * Get current user profile
 */
router.get('/profile', verifyAuthToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found',
      });
    }

    const wallet = await Wallet.findOne({ userId: user._id });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      user: {
        id: user._id,
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.telegramUsername,
        email: user.email,
        phoneNumber: user.phoneNumber,
        photoUrl: user.photoUrl,
        status: user.status,
        kycLevel: user.kycLevel,
        verifiedAt: user.verifiedAt,
        stats: {
          totalGamesPlayed: user.totalGamesPlayed,
          totalGamesWon: user.totalGamesWon,
          totalAmountWon: user.totalAmountWon,
          totalAmountLost: user.totalAmountLost,
          winRate: user.winRate,
        },
      },
      wallet: {
        balance: wallet.balance,
        lockedBalance: wallet.lockedBalance,
        availableBalance: wallet.availableBalance,
        totalDeposited: wallet.totalDeposited,
        totalWithdrawn: wallet.totalWithdrawn,
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
 * PUT /auth/profile
 * Update user profile
 */
router.put('/profile', verifyAuthToken, async (req, res) => {
  try {
    const { email, phoneNumber, firstName, lastName } = req.body;

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found',
      });
    }

    // Validate and update email
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid email format',
        });
      }
      user.email = email;
    }

    // Validate and update phone
    if (phoneNumber) {
      if (!isValidEthiopianPhone(phoneNumber)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid Ethiopian phone number',
        });
      }
      user.phoneNumber = normalizePhoneNumber(phoneNumber);
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;

    await user.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
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
 * POST /auth/verify-phone
 * Verify phone number for TeleBirr
 */
router.post('/verify-phone', verifyAuthToken, async (req, res) => {
  try {
    const { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Phone number and verification code required',
      });
    }

    if (!isValidEthiopianPhone(phoneNumber)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid Ethiopian phone number',
      });
    }

    const user = await User.findById(req.user.userId);

    // TODO: Integrate with TeleBirr verification service
    // For now, just update the phone number
    user.phoneNumber = normalizePhoneNumber(phoneNumber);
    user.teleBirrPhoneNumber = normalizePhoneNumber(phoneNumber);
    user.teleBirrVerified = true;

    await user.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Phone number verified',
      user: {
        phoneNumber: user.phoneNumber,
        teleBirrVerified: user.teleBirrVerified,
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

export default router;
