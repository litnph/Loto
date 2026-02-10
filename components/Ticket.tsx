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
    <div className="ticket-container">
      {ticket.rows.map((row, rowIndex) => {
          const isSeparator = (rowIndex + 1) % 3 === 0 && rowIndex !== ticket.rows.length - 1;
          
          return (
          <React.Fragment key={rowIndex}>
            <div className="ticket-row">
              {row.map((cell, colIndex) => {
                const isMarked = cell !== null && markedNumbers.has(cell);
                let cellClass = 'ticket-cell';
                if (cell === null) cellClass += ' cell-empty';
                else if (isMarked) cellClass += ' cell-marked';
                else cellClass += ' cell-number';

                return (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    onClick={() => {
                      if (cell !== null && onNumberClick && !disabled) {
                        onNumberClick(cell);
                      }
                    }}
                    className={cellClass}
                  >
                    {cell !== null ? cell : ''}
                  </div>
                );
              })}
            </div>
            {isSeparator && (
              <div className="ticket-separator">
                  <div className="ticket-label">Vé { Math.floor((rowIndex + 1) / 3)}</div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Ticket;