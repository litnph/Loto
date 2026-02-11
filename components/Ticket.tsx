import React from 'react';
import { TicketData } from '../types';

interface TicketProps {
  ticket: TicketData;
  markedNumbers: Set<number>;
  onNumberClick?: (num: number) => void;
  disabled?: boolean;
  color?: string; // New prop for custom color
}

const Ticket: React.FC<TicketProps> = ({ ticket, markedNumbers, onNumberClick, disabled, color }) => {
  // Create a style object to override CSS variables for this specific ticket
  const containerStyle = color ? {
    '--primary': color,
    '--primary-dark': color, // Simplify for now, or darken via JS if needed
    '--primary-light': `${color}15`, // 15 is hex alpha ~8%
  } as React.CSSProperties : {};

  return (
    <div className="ticket-container" style={containerStyle}>
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
      
      {/* Inline styles to handle dynamic colors for children elements */}
      <style>{`
        .ticket-container[style*="--primary"] .cell-marked {
          background-color: var(--primary);
        }
        .ticket-container[style*="--primary"] .cell-number {
          background-color: var(--primary-light);
          border-color: var(--primary-light);
          color: #1f2937;
        }
        .ticket-container[style*="--primary"] .cell-number:hover {
           filter: brightness(0.95);
        }
        .ticket-container[style*="--primary"] {
          border-color: var(--primary);
        }
      `}</style>
    </div>
  );
};

// Optimization: Only re-render if markedNumbers changed specifically for this ticket's numbers
// or if the color/disabled state changes.
export default React.memo(Ticket, (prev, next) => {
    if (prev.color !== next.color) return false;
    if (prev.disabled !== next.disabled) return false;
    
    // Check if the marked numbers relevant to this ticket have changed
    // This is a deeper check but prevents re-rendering when marking numbers not on this ticket
    // However, for simplicity and speed (since Set comparison is hard), 
    // we simply check reference or size, or just let Memo handle prop diffs.
    // Since markedNumbers is a Set (mutable reference in some patterns, but here we replace it),
    // React.memo w/ default shallow comparison is usually enough if we manage state correctly.
    // But since `markedNumbers` is a NEW Set every time, we need to be careful.
    
    // Simple optimization: If the sets are the same reference (no change), skip.
    if (prev.markedNumbers === next.markedNumbers) return true;
    
    return false; // Re-render if markedNumbers reference changed
});