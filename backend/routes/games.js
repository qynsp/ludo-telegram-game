import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { User, Game, Wallet, Bet, Transaction } from '../models/index.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS, GAME_STATUS, BET_STATUS } from '../config/constants.js';
import {
  generateGameCode,
  generateBetId,
  generateTransactionId,
  validateBetAmount,
  calculatePayouts,
} from '../utils/helpers.js';
import {
  initializeBoard,
  rollDice,
  movePiece,
  bringPieceOut,
  getValidMoves,
  hasPlayerWon,
  getCompletionOrder,
  isGameOver,
  getBoardSummary,
  validateMove,
  calculatePayouts as calculateGamePayouts,
} from '../utils/gameEngine.js';

const router = express.Router();

/**
 * POST /games/create
 * Create new game and place bet
 * Body: { betAmount }
 */
router.post('/create', verifyAuthToken, async (req, res) => {
  try {
    const { betAmount } = req.body;

    // Validate bet
    const validation = validateBetAmount(betAmount, 10, 10000);
    if (!validation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_BET,
        message: validation.error,
      });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId: req.user.userId });
    if (wallet.availableBalance < betAmount) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INSUFFICIENT_BALANCE,
        message: `Insufficient balance. Available: ${wallet.availableBalance} ETB`,
      });
    }

    // Create game
    const gameId = uuidv4();
    const gameCode = generateGameCode();

    const game = await Game.create({
      gameId,
      gameCode,
      players: [
        {
          userId: req.user.userId,
          position: 0,
          color: 'red',
          joinedAt: new Date(),
        },
      ],
      status: GAME_STATUS.WAITING,
      currentPlayerIndex: 0,
      boardState: initializeBoard(),
      totalPot: betAmount,
    });

    // Create bet
    const betId = generateBetId();
    await Bet.create({
      betId,
      gameId: game._id,
      userId: req.user.userId,
      betAmount,
      status: BET_STATUS.ACTIVE,
      placedAt: new Date(),
      participantCount: 1,
    });

    // Lock balance
    wallet.lockedBalance += betAmount;
    wallet.availableBalance = wallet.balance - wallet.lockedBalance;
    await wallet.save();

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Game created',
      game: {
        gameId,
        gameCode,
        status: game.status,
        totalPot: game.totalPot,
        playerCount: 1,
      },
    });
  } catch (error) {
    console.error('Create game error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * POST /games/join
 * Join existing game
 * Body: { gameCode, betAmount }
 */
router.post('/join', verifyAuthToken, async (req, res) => {
  try {
    const { gameCode, betAmount } = req.body;

    if (!gameCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Game code required',
      });
    }

    // Validate bet
    const validation = validateBetAmount(betAmount, 10, 10000);
    if (!validation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_BET,
        message: validation.error,
      });
    }

    // Find game
    const game = await Game.findOne({ gameCode });
    if (!game) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.GAME_NOT_FOUND,
        message: 'Game not found',
      });
    }

    if (game.status !== GAME_STATUS.WAITING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_GAME_STATE,
        message: 'Game has already started',
      });
    }

    if (game.players.length >= 4) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.GAME_FULL,
        message: 'Game is full',
      });
    }

    // Check if already in game
    if (game.players.some(p => p.userId.toString() === req.user.userId.toString())) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'ALREADY_IN_GAME',
        message: 'You are already in this game',
      });
    }

    // Check wallet
    const wallet = await Wallet.findOne({ userId: req.user.userId });
    if (wallet.availableBalance < betAmount) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INSUFFICIENT_BALANCE,
        message: `Insufficient balance. Available: ${wallet.availableBalance} ETB`,
      });
    }

    // Add player to game
    const colors = ['red', 'yellow', 'blue', 'green'];
    const usedColors = game.players.map(p => p.color);
    const availableColor = colors.find(c => !usedColors.includes(c));

    game.players.push({
      userId: req.user.userId,
      position: game.players.length,
      color: availableColor,
      joinedAt: new Date(),
    });

    game.totalPot += betAmount;
    await game.save();

    // Create bet
    const betId = generateBetId();
    await Bet.create({
      betId,
      gameId: game._id,
      userId: req.user.userId,
      betAmount,
      status: BET_STATUS.ACTIVE,
      placedAt: new Date(),
      participantCount: game.players.length,
    });

    // Lock balance
    wallet.lockedBalance += betAmount;
    wallet.availableBalance = wallet.balance - wallet.lockedBalance;
    await wallet.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Joined game',
      game: {
        gameId: game.gameId,
        gameCode: game.gameCode,
        status: game.status,
        playerCount: game.players.length,
        totalPot: game.totalPot,
        players: game.players.map(p => ({
          color: p.color,
          joinedAt: p.joinedAt,
        })),
      },
    });
  } catch (error) {
    console.error('Join game error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    });
  }
});

/**
 * POST /games/:gameId/start
 * Start the game
 */
router.post('/:gameId/start', verifyAuthToken, async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.GAME_NOT_FOUND,
      });
    }

    if (game.status !== GAME_STATUS.WAITING) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: ERROR_CODES.INVALID_GAME_STATE,
        message: 'Game cannot be started',
      });
    }

    if (game.players.length < 2) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'NOT_ENOUGH_PLAYERS',
        message: 'At least 2 players required',
      });
    }

    game.status = GAME_STATUS.IN_PROGRESS;
    game.startedAt = new Date();
    game.boardState = initializeBoard();
    await game.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Game started',
      game: {
        gameId: game.gameId,
        status: game.status,
        startedAt: game.startedAt,
        players: game.players.length,
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
 * POST /games/:gameId/roll-dice
 * Roll dice for current player
 */
router.post('/:gameId/roll-dice', verifyAuthToken, async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.GAME_NOT_FOUND,
      });
    }

    // Check if user is current player
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer.userId.toString() !== req.user.userId.toString()) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: 'NOT_YOUR_TURN',
        message: 'It is not your turn',
      });
    }

    const diceValue = rollDice();
    const color = currentPlayer.color;

    const validMoves = getValidMoves(game.boardState, color, diceValue);

    game.lastDiceRoll = diceValue;
    game.diceRolledAt = new Date();
    game.gameHistory.push({
      turn: game.currentTurn,
      playerIndex: game.currentPlayerIndex,
      action: 'roll_dice',
      data: { diceValue },
      timestamp: new Date(),
    });

    await game.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Dice rolled',
      diceValue,
      validMoves,
      boardSummary: getBoardSummary(game.boardState),
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
 * GET /games/:gameId
 * Get game state
 */
router.get('/:gameId', verifyAuthToken, async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId }).populate('players.userId', 'firstName lastName');

    if (!game) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.GAME_NOT_FOUND,
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      game: {
        gameId: game.gameId,
        gameCode: game.gameCode,
        status: game.status,
        totalPot: game.totalPot,
        currentPlayerIndex: game.currentPlayerIndex,
        lastDiceRoll: game.lastDiceRoll,
        boardSummary: getBoardSummary(game.boardState),
        players: game.players.map((p, i) => ({
          position: p.position,
          color: p.color,
          isCurrent: i === game.currentPlayerIndex,
          joinedAt: p.joinedAt,
        })),
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
