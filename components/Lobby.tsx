import React, { useState } from 'react';
import { User, Users, Play, Loader2 } from 'lucide-react';

interface LobbyProps {
  onCreateRoom: (playerName: string) => void;
  isCreating: boolean;
}

const Lobby: React.FC<LobbyProps> = ({ onCreateRoom, isCreating }) => {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onCreateRoom(name);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border-t-4 border-red-500">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-red-600 mb-2">LOTO VUI</h1>
          <p className="text-gray-500">Trò chơi dân gian vui nhộn</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên của bạn</label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                placeholder="Nhập tên để chơi..."
                required
              />
              <User className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
            </div>
          </div>

          <button
            type="submit"
            disabled={!name.trim() || isCreating}
            className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold py-3 px-6 rounded-lg transform transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <Loader2 className="animate-spin h-5 w-5" />
            ) : (
              <>
                <Play className="h-5 w-5" />
                <span>Tạo Phòng Mới</span>
              </>
            )}
          </button>
          
          <div className="text-center text-xs text-gray-400 mt-4">
             Mã phòng sẽ được tạo tự động. Các người chơi AI sẽ tham gia cùng bạn.
          </div>
        </form>
      </div>
    </div>
  );
};

export default Lobby;