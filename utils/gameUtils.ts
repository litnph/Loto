import { TicketData, CellValue, TICKET_COLORS } from '../types';

// Generate a valid Vietnamese Loto ticket (1 Lá = 9 rows)
export const generateTicket = (color?: string): TicketData => {
  const rowsCount = 9;
  const numbersPerRow = 5;
  const ticket: CellValue[][] = Array(rowsCount).fill(null).map(() => Array(9).fill(null));
  const usedNumbers = new Set<number>();

  const getRangeStart = (colIndex: number) => {
    if (colIndex === 0) return 1;
    return colIndex * 10;
  };
  
  const getRangeEnd = (colIndex: number) => {
     if (colIndex === 0) return 9;
     if (colIndex === 8) return 90;
     return (colIndex * 10) + 9;
  };

  // Generate rows
  for (let r = 0; r < rowsCount; r++) {
    let rowFilled = false;
    while (!rowFilled) {
        const availableCols = [0,1,2,3,4,5,6,7,8];
        availableCols.sort(() => Math.random() - 0.5);
        
        const selectedCols: number[] = [];
        
        for (const col of availableCols) {
             if (selectedCols.length >= numbersPerRow) break;
             const start = getRangeStart(col);
             const end = getRangeEnd(col);
             let usedCountInCol = 0;
             for(let n = start; n <= end; n++) {
                 if (usedNumbers.has(n)) usedCountInCol++;
             }
             const totalInCol = (end - start + 1);
             if (usedCountInCol < totalInCol) {
                 selectedCols.push(col);
             }
        }
        
        if (selectedCols.length === numbersPerRow) {
            selectedCols.sort((a,b) => a-b);
            for (const col of selectedCols) {
                let num;
                const start = getRangeStart(col);
                const end = getRangeEnd(col);
                do {
                    num = Math.floor(Math.random() * (end - start + 1)) + start;
                } while (usedNumbers.has(num));
                ticket[r][col] = num;
                usedNumbers.add(num);
            }
            rowFilled = true;
        }
    }
  }

  // Sort numbers vertically
  for (let c = 0; c < 9; c++) {
      const numsInCol: number[] = [];
      const rowIndices: number[] = [];
      for(let r = 0; r < rowsCount; r++) {
          if (ticket[r][c] !== null) {
              numsInCol.push(ticket[r][c] as number);
              rowIndices.push(r);
          }
      }
      numsInCol.sort((a,b) => a-b);
      rowIndices.forEach((r, i) => {
          ticket[r][c] = numsInCol[i];
      });
  }

  return {
    rows: ticket,
    id: Math.random().toString(36).substr(2, 9),
    color: color || TICKET_COLORS[Math.floor(Math.random() * TICKET_COLORS.length)]
  };
};

// Check win across ALL sheets a player has
export const checkWin = (sheets: TicketData[], markedNumbers: Set<number>): number[] | null => {
  for (const sheet of sheets) {
      for (const row of sheet.rows) {
        const numbersInRow = row.filter((n): n is number => n !== null);
        if (numbersInRow.length > 0 && numbersInRow.every(n => markedNumbers.has(n))) {
          return numbersInRow;
        }
      }
  }
  return null;
};

// Check waiting status across ALL sheets
export const checkWaiting = (sheets: TicketData[], markedNumbers: Set<number>): boolean => {
    for (const sheet of sheets) {
        for (const row of sheet.rows) {
            const numbersInRow = row.filter((n): n is number => n !== null);
            const markedCount = numbersInRow.filter(n => markedNumbers.has(n)).length;
            if (numbersInRow.length === 5 && markedCount === 4) {
                return true;
            }
        }
    }
    return false;
};

export const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};