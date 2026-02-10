import React from 'react';
import { TicketData } from '../types';

interface TicketProps {
  ticket: TicketData;
  markedNumbers: Set<number>;
  onNumberClick?: (num: number) => void;
  disabled?: boolean;
}

const Ticket: React.FC<TicketProps> = ({ ticket, markedNumbers, onNumberClick, disabled }) => {
  return (
    <div className="bg-white p-2 rounded-lg shadow-lg border-2 border-red-500 max-w-full overflow-x-auto">
      <div className="min-w-[300px]">
        {ticket.rows.map((row, rowIndex) => {
           // Add a separator margin every 3 rows to mimic standard ticket sheets
           const isSeparator = (rowIndex + 1) % 3 === 0 && rowIndex !== ticket.rows.length - 1;
           
           return (
            <React.Fragment key={rowIndex}>
              <div className="grid grid-cols-9 gap-1 h-12 mb-1">
                {row.map((cell, colIndex) => {
                  const isMarked = cell !== null && markedNumbers.has(cell);
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      onClick={() => {
                        if (cell !== null && onNumberClick && !disabled) {
                          onNumberClick(cell);
                        }
                      }}
                      className={`
                        flex items-center justify-center text-sm sm:text-base font-bold rounded cursor-pointer select-none transition-all
                        ${cell === null ? 'bg-gray-50' : ''}
                        ${cell !== null && !isMarked ? 'bg-yellow-50 hover:bg-yellow-100 text-gray-800 border border-yellow-200' : ''}
                        ${isMarked ? 'bg-red-500 text-white shadow-inner transform scale-95' : ''}
                      `}
                    >
                      {cell !== null ? cell : ''}
                    </div>
                  );
                })}
              </div>
              {isSeparator && (
                <div className="h-0 border-b-2 border-dashed border-gray-300 my-2 relative">
                   <div className="absolute left-0 -top-2 text-gray-300 text-[10px] px-1 bg-white">Vé { Math.floor((rowIndex + 1) / 3)}</div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default Ticket;