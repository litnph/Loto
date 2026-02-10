import { TicketData, CellValue } from '../types';

// Generate a valid Vietnamese Loto ticket
// Now generating 9 rows as requested.
// Each row has 5 numbers. Total 45 numbers on the ticket.
// Columns correspond to ranges: 1-9, 10-19, ..., 80-90.
export const generateTicket = (): TicketData => {
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
    // Retry loop to ensure we pick valid columns that haven't exhausted their numbers
    while (!rowFilled) {
        const availableCols = [0,1,2,3,4,5,6,7,8];
        // Shuffle columns to pick random ones
        availableCols.sort(() => Math.random() - 0.5);
        
        const selectedCols: number[] = [];
        
        // Try to pick 5 columns that have available numbers
        for (const col of availableCols) {
             if (selectedCols.length >= numbersPerRow) break;
             
             const start = getRangeStart(col);
             const end = getRangeEnd(col);
             
             // Count used numbers in this column's range
             let usedCountInCol = 0;
             for(let n = start; n <= end; n++) {
                 if (usedNumbers.has(n)) usedCountInCol++;
             }
             
             const totalInCol = (end - start + 1);
             
             // If this column still has space
             if (usedCountInCol < totalInCol) {
                 selectedCols.push(col);
             }
        }
        
        // If we successfully found 5 valid columns
        if (selectedCols.length === numbersPerRow) {
            selectedCols.sort((a,b) => a-b);
            
            for (const col of selectedCols) {
                let num;
                const start = getRangeStart(col);
                const end = getRangeEnd(col);
                // Find a random unused number in range
                do {
                    num = Math.floor(Math.random() * (end - start + 1)) + start;
                } while (usedNumbers.has(num));
                
                ticket[r][col] = num;
                usedNumbers.add(num);
            }
            rowFilled = true;
        } else {
            // Corner case: random selection painted us into a corner (rare with 45/90 density).
            // Just retry the loop for this row.
        }
    }
  }

  // Sort numbers vertically within each column for better readability
  for (let c = 0; c < 9; c++) {
      const numsInCol: number[] = [];
      const rowIndices: number[] = [];
      
      for(let r = 0; r < rowsCount; r++) {
          if (ticket[r][c] !== null) {
              numsInCol.push(ticket[r][c] as number);
              rowIndices.push(r);
          }
      }
      
      // Sort values
      numsInCol.sort((a,b) => a-b);
      
      // Place them back in order
      rowIndices.forEach((r, i) => {
          ticket[r][c] = numsInCol[i];
      });
  }

  return {
    rows: ticket,
    id: Math.random().toString(36).substr(2, 9),
  };
};

export const checkWin = (ticket: TicketData, markedNumbers: Set<number>): boolean => {
  // Win condition: Any row is fully marked
  for (const row of ticket.rows) {
    const numbersInRow = row.filter((n): n is number => n !== null);
    if (numbersInRow.length > 0 && numbersInRow.every(n => markedNumbers.has(n))) {
      return true;
    }
  }
  return false;
};