import axios from 'axios';
import crypto from 'crypto';

/**
 * TeleBirr API Integration
 * Handles all payment operations
 */

const TELEBIRR_API_BASE_URL = process.env.TELEBIRR_SANDBOX_MODE === 'true'
  ? 'https://api-sandbox.telebirr.com'
  : 'https://api.telebirr.com';

const API_KEY = process.env.TELEBIRR_API_KEY;
const API_SECRET = process.env.TELEBIRR_API_SECRET;
const MERCHANT_ID = process.env.TELEBIRR_MERCHANT_ID;

/**
 * Generate signature for TeleBirr API requests
 */
const generateSignature = (data, timestamp) => {
  const signatureString = `${MERCHANT_ID}${data}${timestamp}${API_SECRET}`;
  return crypto
    .createHash('sha256')
    .update(signatureString)
    .digest('hex');
};

/**
 * Make authenticated request to TeleBirr
 */
const makeRequest = async (method, endpoint, data = null) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(JSON.stringify(data || {}), timestamp);

    const config = {
      method,
      url: `${TELEBIRR_API_BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'X-Merchant-ID': MERCHANT_ID,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      timeout: 30000,
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
    };
  }
};

/**
 * Initiate deposit (redirect to TeleBirr payment page)
 */
export const initiateDeposit = async (userId, amount, phoneNumber) => {
  const depositId = `DEP-${Date.now()}-${userId}`;

  const payload = {
    merchantId: MERCHANT_ID,
    orderId: depositId,
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'ETB',
    description: `Ludo Game Deposit - ${depositId}`,
    phoneNumber,
    callbackUrl: `${process.env.FRONTEND_URL}/api/telebirr/deposit-callback`,
    returnUrl: `${process.env.FRONTEND_URL}/wallet?deposit=${depositId}`,
  };

  const response = await makeRequest('POST', '/api/v1/payment/initiate', payload);

  if (response.success) {
    return {
      success: true,
      depositId,
      paymentUrl: response.data.paymentUrl,
      transactionId: response.data.transactionId,
    };
  }

  return {
    success: false,
    error: response.error,
  };
};

/**
 * Check deposit status
 */
export const checkDepositStatus = async (transactionId) => {
  const response = await makeRequest(
    'GET',
    `/api/v1/payment/status/${transactionId}`
  );

  if (response.success) {
    return {
      success: true,
      status: response.data.status, // 'completed', 'pending', 'failed'
      amount: response.data.amount / 100, // Convert back to ETB
      transactionId: response.data.transactionId,
    };
  }

  return {
    success: false,
    error: response.error,
  };
};

/**
 * Initiate withdrawal (send money back to user)
 */
export const initiateWithdrawal = async (userId, amount, phoneNumber) => {
  const withdrawalId = `WD-${Date.now()}-${userId}`;

  const payload = {
    merchantId: MERCHANT_ID,
    withdrawalId,
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'ETB',
    phoneNumber,
    description: `Ludo Game Withdrawal - ${withdrawalId}`,
    notificationUrl: `${process.env.FRONTEND_URL}/api/telebirr/withdrawal-callback`,
  };

  const response = await makeRequest('POST', '/api/v1/withdrawal/initiate', payload);

  if (response.success) {
    return {
      success: true,
      withdrawalId,
      transactionId: response.data.transactionId,
      estimatedTime: response.data.estimatedProcessingTime, // in minutes
    };
  }

  return {
    success: false,
    error: response.error,
  };
};

/**
 * Check withdrawal status
 */
export const checkWithdrawalStatus = async (transactionId) => {
  const response = await makeRequest(
    'GET',
    `/api/v1/withdrawal/status/${transactionId}`
  );

  if (response.success) {
    return {
      success: true,
      status: response.data.status, // 'completed', 'processing', 'failed'
      amount: response.data.amount / 100,
      transactionId: response.data.transactionId,
    };
  }

  return {
    success: false,
    error: response.error,
  };
};

/**
 * Verify webhook signature from TeleBirr
 */
export const verifyWebhookSignature = (payload, signature) => {
  const timestamp = payload.timestamp;
  const expectedSignature = generateSignature(JSON.stringify(payload), timestamp);
  return signature === expectedSignature;
};

/**
 * Get merchant balance
 */
export const getMerchantBalance = async () => {
  const response = await makeRequest('GET', '/api/v1/merchant/balance');

  if (response.success) {
    return {
      success: true,
      balance: response.data.balance / 100,
      currency: 'ETB',
    };
  }

  return {
    success: false,
    error: response.error,
  };
};

/**
 * Get transaction history
 */
export const getTransactionHistory = async (limit = 50, offset = 0) => {
  const response = await makeRequest('GET', '/api/v1/transactions', {
    merchantId: MERCHANT_ID,
    limit,
    offset,
  });

  if (response.success) {
    return {
      success: true,
      transactions: response.data.transactions,
      total: response.data.total,
    };
  }

  return {
    success: false,
    error: response.error,
  };
};
