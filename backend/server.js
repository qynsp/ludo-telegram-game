import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { connectDatabase } from './models/index.js';
import { corsHandler, errorHandler, createRateLimiter } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import walletRoutes from './routes/wallet.js';
import gamesRoutes from './routes/games.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware
// ============================================

// Security headers
app.use(helmet());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use(corsHandler);

// Rate limiting
const rateLimiter = createRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
);
app.use('/api', rateLimiter);

// ============================================
// Database Connection
// ============================================

let dbConnection;

const initializeDatabase = async () => {
  try {
    dbConnection = await connectDatabase();
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
};

// ============================================
// Routes
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: dbConnection ? 'connected' : 'disconnected',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/games', gamesRoutes);

// Welcome route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Ludo Telegram Game API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      wallet: '/api/wallet',
      games: '/api/games',
      health: '/health',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: 'Route not found',
  });
});

// Error handler
app.use(errorHandler);

// ============================================
// Server Startup
// ============================================

const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();

    // Start listening
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║   🎮 LUDO TELEGRAM GAME API STARTED 🎮    ║
╚════════════════════════════════════════════╝

✅ Server running on http://localhost:${PORT}
📊 Environment: ${process.env.NODE_ENV || 'development'}
🗄️  Database: ${process.env.MONGODB_URI?.split('@')[1]?.split('/')[0] || 'local'}
🔐 JWT Secret: ${process.env.JWT_SECRET ? '✓ Set' : '✗ NOT SET'}
💳 TeleBirr: ${process.env.TELEBIRR_API_KEY ? '✓ Configured' : '✗ NOT SET'}

Available endpoints:
  GET  /                    - Welcome
  GET  /health              - Health check
  
  POST /api/auth/telegram   - Telegram login/signup
  GET  /api/auth/profile    - Get user profile
  PUT  /api/auth/profile    - Update profile
  POST /api/auth/verify-phone - Verify phone

  GET  /api/wallet/balance  - Get balance
  POST /api/wallet/deposit  - Deposit via TeleBirr
  POST /api/wallet/withdrawal - Withdraw via TeleBirr
  GET  /api/wallet/transactions - Transaction history

  POST /api/games/create    - Create new game
  POST /api/games/join      - Join game
  POST /api/games/:id/start - Start game
  POST /api/games/:id/roll-dice - Roll dice
  GET  /api/games/:id       - Get game state

⚠️  Ready for WebSocket implementation (Socket.IO)
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start server
startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM signal received: closing HTTP server');
  dbConnection?.close?.(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('📛 SIGINT signal received: closing HTTP server');
  dbConnection?.close?.(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  });
});

export default app;
