import React from 'react';

interface NumberBoardProps {
  calledNumbers: number[];
  currentNumber: number | null;
}

const NumberBoard: React.FC<NumberBoardProps> = ({ calledNumbers, currentNumber }) => {
  // Sort for easier checking, or display in order of call?
  // Usually a board shows 1-90 grid to see what's out.
  const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1);

  return (
    <div className="bg-white p-4 rounded-xl shadow-md border border-gray-200">
      <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center">
        <span className="w-2 h-6 bg-red-500 rounded-full mr-2"></span>
        Bảng Số Đã Gọi
      </h3>
      <div className="grid grid-cols-10 gap-1 sm:gap-2">
        {allNumbers.map((num) => {
            const isCalled = calledNumbers.includes(num);
            const isCurrent = num === currentNumber;
            return (
                <div
                    key={num}
                    className={`
                        aspect-square flex items-center justify-center text-xs sm:text-sm rounded-full font-medium transition-colors duration-300
                        ${isCurrent ? 'bg-red-600 text-white scale-110 ring-2 ring-red-300 z-10 font-bold' : ''}
                        ${!isCurrent && isCalled ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-300'}
                    `}
                >
                    {num}
                </div>
            )
        })}
      </div>
    </div>
  );
};

export default NumberBoard;