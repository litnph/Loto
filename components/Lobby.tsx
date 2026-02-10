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
    <div className="lobby-wrapper">
      <div className="lobby-card">
        
        <div className="text-center" style={{paddingTop: '2rem', paddingBottom: '1.5rem'}}>
          <h1 className="text-primary" style={{fontSize: '2.25rem', fontWeight: '800', margin: 0}}>LOTO VUI</h1>
          <p className="text-muted" style={{margin: 0}}>Trò chơi dân gian vui nhộn</p>
        </div>

        <div className="lobby-tabs">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`tab-btn ${mode === 'create' ? 'active' : ''}`}
          >
            Tạo Phòng
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`tab-btn ${mode === 'join' ? 'active' : ''}`}
          >
            Vào Phòng
          </button>
        </div>

        <div style={{padding: '2rem'}}>
          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label style={{display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem'}}>Tên của bạn</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-input"
                  placeholder="Nhập tên hiển thị..."
                  required
                />
                <User className="input-icon" size={20} />
              </div>
            </div>

            {mode === 'join' && (
              <div className="input-group" style={{animation: 'fadeIn 0.3s ease-out'}}>
                <label style={{display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem'}}>Mã Phòng</label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    className="form-input"
                    placeholder="Nhập mã phòng (VD: X8K9L)"
                    style={{fontFamily: 'monospace', textTransform: 'uppercase'}}
                    required
                  />
                  <Users className="input-icon" size={20} />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || (mode === 'join' && !roomCode.trim()) || isCreating}
              className="btn btn-primary w-full"
            >
              {isCreating ? (
                <Loader2 className="animate-spin" size={20} />
              ) : mode === 'create' ? (
                <>
                  <Play size={20} />
                  <span>Tạo Phòng Mới</span>
                </>
              ) : (
                <>
                  <LogIn size={20} />
                  <span>Vào Phòng Ngay</span>
                </>
              )}
            </button>
            
            <div className="text-center" style={{fontSize: '0.75rem', color: '#9ca3af', marginTop: '1rem'}}>
              {mode === 'create' 
                ? 'Mã phòng sẽ được tạo tự động để bạn chia sẻ.' 
                : 'Nhập mã phòng từ bạn bè để tham gia trò chơi.'}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Lobby;