import React from 'react';

interface NumberBoardProps {
  calledNumbers: number[];
  currentNumber: number | null;
}

const NumberBoard: React.FC<NumberBoardProps> = ({ calledNumbers, currentNumber }) => {
  const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1);

  return (
    <div className="card" style={{padding: '1rem'}}>
      <h3 className="font-bold" style={{marginBottom: '0.75rem', display: 'flex', alignItems: 'center'}}>
        <span style={{width: '6px', height: '1.25rem', background: '#dc2626', borderRadius: '999px', marginRight: '0.5rem'}}></span>
        Bảng Số Đã Gọi
      </h3>
      <div className="board-grid">
        {allNumbers.map((num) => {
            const isCalled = calledNumbers.includes(num);
            const isCurrent = num === currentNumber;
            
            let cellClass = 'board-cell';
            if (isCurrent) cellClass += ' board-active';
            else if (isCalled) cellClass += ' board-called';
            else cellClass += ' board-default';

            return (
                <div key={num} className={cellClass}>
                    {num}
                </div>
            )
        })}
      </div>
    </div>
  );
};

export default NumberBoard;