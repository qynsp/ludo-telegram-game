/**
 * Ludo Game Engine
 * Core game logic, rules, and mechanics
 */

import { LUDO_CONFIG, DICE_VALUES, DICE_ROLL_NEEDED_TO_START } from '../config/constants.js';

/**
 * Initialize new game board
 * Returns initial piece positions for all 4 players
 */
export const initializeBoard = () => {
  return {
    red: { home: 4, active: [null, null, null, null], finished: 0 },
    yellow: { home: 4, active: [null, null, null, null], finished: 0 },
    blue: { home: 4, active: [null, null, null, null], finished: 0 },
    green: { home: 4, active: [null, null, null, null], finished: 0 },
  };
};

/**
 * Roll a dice (1-6)
 * @returns {number} Dice value
 */
export const rollDice = () => {
  return Math.floor(Math.random() * 6) + 1;
};

/**
 * Get safe squares (cannot be captured)
 * @returns {array} Safe square numbers
 */
export const getSafeSquares = () => {
  return LUDO_CONFIG.SAFE_SQUARES;
};

/**
 * Check if a square is safe
 * @param {number} squareNumber
 * @returns {boolean}
 */
export const isSafeSquare = (squareNumber) => {
  return getSafeSquares().includes(squareNumber);
};

/**
 * Get all pieces of a player
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @returns {array} Array of piece positions
 */
export const getPlayerPieces = (board, color) => {
  const playerData = board[color];
  const pieces = [];

  // Home pieces
  for (let i = 0; i < playerData.home; i++) {
    pieces.push({ position: 'home', index: i });
  }

  // Active pieces on board
  playerData.active.forEach((pos, index) => {
    if (pos !== null) {
      pieces.push({ position: pos, index });
    }
  });

  // Finished pieces
  for (let i = 0; i < playerData.finished; i++) {
    pieces.push({ position: 'finished', index: i });
  }

  return pieces;
};

/**
 * Bring a piece out from home
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @param {number} pieceIndex - Which piece to move (0-3)
 * @returns {object} Updated board
 */
export const bringPieceOut = (board, color, pieceIndex) => {
  const newBoard = JSON.parse(JSON.stringify(board));
  const startPosition = LUDO_CONFIG.START_POSITIONS[color];

  if (newBoard[color].home > 0 && newBoard[color].active[pieceIndex] === null) {
    newBoard[color].home--;
    newBoard[color].active[pieceIndex] = startPosition;
  }

  return newBoard;
};

/**
 * Move a piece forward
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @param {number} pieceIndex - Which piece to move
 * @param {number} diceValue - How many squares to move
 * @returns {object} {board, capturedPiece, reachedHome}
 */
export const movePiece = (board, color, pieceIndex, diceValue) => {
  const newBoard = JSON.parse(JSON.stringify(board));
  const piece = newBoard[color].active[pieceIndex];

  if (piece === null) {
    return { success: false, error: 'Piece not on board' };
  }

  // Calculate new position
  let newPosition = piece + diceValue;

  // Check if reached home
  const homePosition = LUDO_CONFIG.HOME_POSITIONS[color];
  let reachedHome = false;

  if (newPosition === homePosition) {
    newBoard[color].active[pieceIndex] = null;
    newBoard[color].finished++;
    reachedHome = true;
    return { success: true, board: newBoard, reachedHome };
  } else if (newPosition > homePosition) {
    // Overshot - don't move
    return { success: false, error: 'Cannot overshoot home' };
  }

  // Regular move
  newBoard[color].active[pieceIndex] = newPosition;

  // Check for captures
  let capturedPiece = null;
  if (!isSafeSquare(newPosition)) {
    for (const otherColor of LUDO_CONFIG.COLORS) {
      if (otherColor === color) continue;

      for (let i = 0; i < newBoard[otherColor].active.length; i++) {
        if (newBoard[otherColor].active[i] === newPosition) {
          // Capture!
          capturedPiece = { color: otherColor, index: i };
          newBoard[otherColor].active[i] = null;
          newBoard[otherColor].home++;
          break;
        }
      }
    }
  }

  return { success: true, board: newBoard, capturedPiece };
};

/**
 * Get all valid moves for a player
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @param {number} diceValue - Dice roll value
 * @returns {array} Valid moves [{pieceIndex, moveType}]
 */
export const getValidMoves = (board, color, diceValue) => {
  const validMoves = [];

  if (diceValue === DICE_ROLL_NEEDED_TO_START) {
    // Can bring a piece out if home exists
    for (let i = 0; i < 4; i++) {
      if (board[color].active[i] === null && board[color].home > 0) {
        validMoves.push({ pieceIndex: i, moveType: 'bring_out' });
      }
    }
  }

  // Can move existing pieces
  for (let i = 0; i < 4; i++) {
    if (board[color].active[i] !== null) {
      const newPos = board[color].active[i] + diceValue;
      if (newPos <= LUDO_CONFIG.HOME_POSITIONS[color]) {
        validMoves.push({ pieceIndex: i, moveType: 'move' });
      }
    }
  }

  return validMoves;
};

/**
 * Check if player has won
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @returns {boolean}
 */
export const hasPlayerWon = (board, color) => {
  return board[color].finished === 4 && board[color].home === 0;
};

/**
 * Get game completion order
 * @param {object} board - Current board state
 * @returns {array} Array of colors in completion order
 */
export const getCompletionOrder = (board) => {
  const order = [];
  const colors = LUDO_CONFIG.COLORS;

  // Check which colors have finished
  for (const color of colors) {
    if (hasPlayerWon(board, color)) {
      order.push(color);
    }
  }

  return order;
};

/**
 * Check if game is over (at least 1 player finished)
 * @param {object} board - Current board state
 * @returns {boolean}
 */
export const isGameOver = (board) => {
  return LUDO_CONFIG.COLORS.some(color => hasPlayerWon(board, color));
};

/**
 * Get board state as summary
 * @param {object} board - Current board state
 * @returns {object} Summary of each player's progress
 */
export const getBoardSummary = (board) => {
  const summary = {};

  for (const color of LUDO_CONFIG.COLORS) {
    const playerBoard = board[color];
    const activePieces = playerBoard.active.filter(p => p !== null).length;

    summary[color] = {
      home: playerBoard.home,
      active: activePieces,
      finished: playerBoard.finished,
      progress: ((playerBoard.finished + activePieces) / 4) * 100,
      won: playerBoard.finished === 4,
    };
  }

  return summary;
};

/**
 * Validate move (ensure it's legal)
 * @param {object} board - Current board state
 * @param {string} color - Player color
 * @param {number} pieceIndex - Piece to move
 * @param {number} diceValue - Dice value
 * @returns {object} {valid, error}
 */
export const validateMove = (board, color, pieceIndex, diceValue) => {
  if (pieceIndex < 0 || pieceIndex > 3) {
    return { valid: false, error: 'Invalid piece index' };
  }

  const piece = board[color].active[pieceIndex];

  // Bringing piece out
  if (diceValue === DICE_ROLL_NEEDED_TO_START && piece === null) {
    return { valid: true };
  }

  // Moving piece on board
  if (piece !== null) {
    const newPos = piece + diceValue;
    if (newPos <= LUDO_CONFIG.HOME_POSITIONS[color]) {
      return { valid: true };
    }
    return { valid: false, error: 'Move would overshoot home' };
  }

  return { valid: false, error: 'Invalid move' };
};

/**
 * Calculate winner payouts
 * @param {array} completionOrder - Order of player colors who finished
 * @param {number} totalPot - Total amount bet
 * @param {number} houseCommissionPercentage - House cut percentage
 * @returns {object} Payout distribution
 */
export const calculatePayouts = (completionOrder, totalPot, houseCommissionPercentage = 30) => {
  const houseCommission = Math.round(totalPot * (houseCommissionPercentage / 100));
  const prizePool = totalPot - houseCommission;

  // Payout distribution: 1st gets 50%, 2nd gets 30%, 3rd gets 20%
  const distribution = {
    1: 0.5,
    2: 0.3,
    3: 0.2,
  };

  const payouts = {};

  completionOrder.forEach((color, index) => {
    const position = index + 1;
    const percentage = distribution[position] || 0;
    payouts[color] = {
      position,
      amount: Math.round(prizePool * percentage),
      percentage,
    };
  });

  return {
    totalPot,
    houseCommission,
    prizePool,
    payouts,
  };
};
