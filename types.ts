export type CellValue = number | null;

// Standard Vietnamese Loto Ticket: 9 columns x 3 rows
// Each row has exactly 5 numbers.
export interface TicketData {
  rows: CellValue[][]; // 3 rows, each length 9
  id: string;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  ticket: TicketData;
  markedNumbers: Set<number>;
  isReady: boolean; // New: Ready status
  color: string;    // New: Ticket color theme (hex)
}

export type GameStatus = 'lobby' | 'waiting' | 'playing' | 'ended';

export interface RoomState {
  code: string;
  players: Player[];
  status: GameStatus;
  calledNumbers: number[];
  currentNumber: number | null;
  winner: Player | null;
  mcCommentary: string;
}

export const TOTAL_NUMBERS = 90;
export const CALL_INTERVAL_MS = 4500; // Time between calls

export const TICKET_COLORS = [
  '#dc2626', // Red (Default)
  '#2563eb', // Blue
  '#16a34a', // Green
  '#9333ea', // Purple
  '#ea580c', // Orange
  '#db2777', // Pink
  '#0891b2', // Cyan
];