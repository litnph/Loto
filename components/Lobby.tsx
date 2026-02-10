import React, { useState } from 'react';
import { User, Users, Play, Loader2, LogIn } from 'lucide-react';

interface LobbyProps {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (playerName: string, roomCode: string) => void;
  isCreating: boolean;
}

const Lobby: React.FC<LobbyProps> = ({ onCreateRoom, onJoinRoom, isCreating }) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (mode === 'create') {
      onCreateRoom(name);
    } else {
      if (roomCode.trim()) {
        onJoinRoom(name, roomCode);
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border-t-4 border-red-500">
        
        {/* Header Title */}
        <div className="text-center pt-8 pb-6">
          <h1 className="text-4xl font-extrabold text-red-600 mb-2">LOTO VUI</h1>
          <p className="text-gray-500">Trò chơi dân gian vui nhộn</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 py-4 text-sm font-bold uppercase tracking-wide transition-colors ${
              mode === 'create' 
                ? 'text-red-600 border-b-2 border-red-600 bg-red-50' 
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            Tạo Phòng
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`flex-1 py-4 text-sm font-bold uppercase tracking-wide transition-colors ${
              mode === 'join' 
                ? 'text-red-600 border-b-2 border-red-600 bg-red-50' 
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            Vào Phòng
          </button>
        </div>

        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên của bạn</label>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                  placeholder="Nhập tên hiển thị..."
                  required
                />
                <User className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
              </div>
            </div>

            {mode === 'join' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="block text-sm font-medium text-gray-700 mb-1">Mã Phòng</label>
                <div className="relative">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all font-mono uppercase"
                    placeholder="Nhập mã phòng (VD: X8K9L)"
                    required
                  />
                  <Users className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || (mode === 'join' && !roomCode.trim()) || isCreating}
              className={`w-full flex items-center justify-center space-x-2 text-white font-bold py-3 px-6 rounded-lg transform transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                 mode === 'create' 
                 ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600'
                 : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
              }`}
            >
              {isCreating ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : mode === 'create' ? (
                <>
                  <Play className="h-5 w-5" />
                  <span>Tạo Phòng Mới</span>
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  <span>Vào Phòng Ngay</span>
                </>
              )}
            </button>
            
            <div className="text-center text-xs text-gray-400 mt-4">
              {mode === 'create' 
                ? 'Mã phòng sẽ được tạo tự động. Các người chơi AI sẽ tham gia cùng bạn.' 
                : 'Nhập mã phòng từ bạn bè để tham gia trò chơi.'}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Lobby;