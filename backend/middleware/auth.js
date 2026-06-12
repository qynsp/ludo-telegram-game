import { verifyToken } from '../config/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '../config/constants.js';

/**
 * Verify JWT Token Middleware
 */
export const verifyAuthToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'No authentication token provided',
      });
    }

    const verification = verifyToken(token);

    if (!verification.valid) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: verification.error,
      });
    }

    // Attach user data to request
    req.user = verification.data;
    next();
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
};

/**
 * Optional Auth Middleware
 * Does not fail if token is missing, but validates if present
 */
export const optionalAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
      const verification = verifyToken(token);
      if (verification.valid) {
        req.user = verification.data;
      }
    }

    next();
  } catch (error) {
    next();
  }
};

/**
 * Rate Limiting Middleware
 */
export const createRateLimiter = (windowMs = 900000, maxRequests = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);
    const recentRequests = userRequests.filter((time) => now - time < windowMs);

    if (recentRequests.length >= maxRequests) {
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      });
    }

    recentRequests.push(now);
    requests.set(key, recentRequests);

    next();
  };
};

/**
 * Validate Request Body
 */
export const validateRequestBody = (requiredFields) => {
  return (req, res, next) => {
    const missing = [];

    requiredFields.forEach((field) => {
      if (!req.body[field]) {
        missing.push(field);
      }
    });

    if (missing.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: `Missing required fields: ${missing.join(', ')}`,
        missing,
      });
    }

    next();
  };
};

/**
 * Error Handler Middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'ValidationError') {
    return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      error: ERROR_CODES.VALIDATION_ERROR,
      message: err.message,
    });
  }

  if (err.name === 'CastError') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid ID format',
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: ERROR_CODES.INTERNAL_ERROR,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error'
      : err.message,
  });
};

/**
 * CORS Middleware
 */
export const corsHandler = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
};
