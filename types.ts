export type CellValue = number | null;

// Standard Vietnamese Loto Sheet (Lá): 9 columns x 9 rows
// User definition: "3 vé = 1 lá". Usually 1 small ticket is 3 rows.
// So 1 Sheet (Lá) = 3 Tickets = 9 rows.
export interface TicketData {
  rows: CellValue[][]; // 9 rows per sheet
  id: string;
  color: string; // Specific color for this sheet
}

export type PlayerStatus = 'playing' | 'spectating';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  sheets: TicketData[]; // A player can buy multiple sheets (Lá)
  markedNumbers: Set<number>;
  isReady: boolean;
  color: string; // Avatar color
  isWaiting: boolean;
  
  // Economy
  balance: number;      // Current money (starts at 0)
  sheetCount: number;   // How many sheets they want to buy
  status: PlayerStatus; // Playing or just watching (late joiners)
}

export type GameStatus = 'lobby' | 'waiting' | 'playing' | 'ended';

export interface RoomState {
  code: string;
  players: Player[];
  status: GameStatus;
  calledNumbers: number[];
  currentNumber: number | null;
  winner: Player | null;
  winningNumbers: number[];
  mcCommentary: string;

  // Economy
  betPrice: number;     // Price per sheet (set by host)
  pot: number;          // Total prize money for the current round
}

export const TOTAL_NUMBERS = 90;
export const CALL_INTERVAL_MS = 6000;

export const TICKET_COLORS = [
  '#dc2626', // Red
  '#2563eb', // Blue
  '#16a34a', // Green
  '#9333ea', // Purple
  '#ea580c', // Orange
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#4b5563', // Gray
  '#059669', // Emerald
  '#d97706', // Amber
];