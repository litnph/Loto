import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, Info, UserCircle2, UserPlus } from 'lucide-react';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<RoomState>({
    code: '',
    players: [],
    status: 'lobby',
    calledNumbers: [],
    currentNumber: null,
    winner: null,
    mcCommentary: '',
  });

  const [playerId, setPlayerId] = useState<string>('');
  const [mcLoading, setMcLoading] = useState(false);
  
  // Ref typed as any to avoid NodeJS namespace issues during Vercel build
  const callIntervalRef = useRef<any>(null);

  // Initialize Audio Context for generic sound (optional, kept simple for now)
  
  const createRoom = (playerName: string) => {
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const myTicket = generateTicket();
    const newPlayer: Player = {
      id: 'host-' + Date.now(),
      name: playerName,
      isHost: true,
      isBot: false,
      ticket: myTicket,
      markedNumbers: new Set(),
    };

    setPlayerId(newPlayer.id);
    setGameState({
      code: newRoomCode,
      players: [newPlayer],
      status: 'waiting',
      calledNumbers: [],
      currentNumber: null,
      winner: null,
      mcCommentary: 'Chào mừng đến với phòng chơi! Đang đợi người chơi khác...',
    });
  };

  // Manual Add Bot function
  const addBot = () => {
    setGameState((prev) => {
        const botNames = ['Bà Tám', 'Cô Ba', 'Chú Bảy', 'Anh Tư', 'Chị Năm', 'Bác Sáu'];
        const existingBots = prev.players.filter(p => p.isBot).length;
        // Cycle names or append number if exhausted
        const baseName = botNames[existingBots % botNames.length];
        const suffix = existingBots >= botNames.length ? ` ${Math.floor(existingBots / botNames.length) + 1}` : '';
        
        const botTicket = generateTicket();
        const newBot: Player = {
          id: `bot-${Date.now()}`,
          name: `${baseName}${suffix} (Bot)`,
          isHost: false,
          isBot: true,
          ticket: botTicket,
          markedNumbers: new Set(),
        };

        return {
          ...prev,
          players: [...prev.players, newBot],
        };
    });
  };

  const startGame = () => {
    // Allow starting with 1 player for testing if needed, though 2 is standard
    if (gameState.players.length < 1) return; 
    setGameState(prev => ({
      ...prev,
      status: 'playing',
      mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
    }));
  };

  const drawNumber = useCallback(async () => {
    setGameState(prev => {
      if (prev.status !== 'playing' || prev.calledNumbers.length >= TOTAL_NUMBERS) return prev;
      
      // Filter out already called numbers
      const available = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1)
        .filter(n => !prev.calledNumbers.includes(n));
      
      if (available.length === 0) return prev;

      const nextNum = available[Math.floor(Math.random() * available.length)];
      
      return {
        ...prev,
        currentNumber: nextNum,
        calledNumbers: [...prev.calledNumbers, nextNum],
        // Bots automatically mark their numbers here for simulation simplicity
        players: prev.players.map(p => {
          if (!p.isBot) return p;
          // Check if bot has this number
          const hasNum = p.ticket.rows.some(row => row.includes(nextNum));
          if (hasNum) {
            const newMarked = new Set(p.markedNumbers);
            newMarked.add(nextNum);
            return { ...p, markedNumbers: newMarked };
          }
          return p;
        })
      };
    });
  }, []);

  // Effect to handle Game Loop (Calling Numbers)
  useEffect(() => {
    if (gameState.status === 'playing' && !gameState.winner) {
      callIntervalRef.current = setInterval(() => {
        drawNumber();
      }, CALL_INTERVAL_MS);
    }
    return () => {
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
    };
  }, [gameState.status, gameState.winner, drawNumber]);

  // Effect to Generate Commentary when currentNumber changes
  useEffect(() => {
    if (gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        setGameState(prev => ({ ...prev, mcCommentary: text }));
        setMcLoading(false);
      };
      fetchCommentary();
    }
  }, [gameState.currentNumber, gameState.status]);

  // Effect to Check for Bot Wins
  useEffect(() => {
    if (gameState.status === 'playing') {
      const winner = gameState.players.find(p => p.isBot && checkWin(p.ticket, p.markedNumbers));
      if (winner) {
        handleWin(winner);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.players, gameState.status]);


  const handleMarkNumber = (num: number) => {
    if (gameState.status !== 'playing') return;
    
    // Allow marking only if called
    if (!gameState.calledNumbers.includes(num)) {
      alert("Số này chưa được gọi!");
      return;
    }

    setGameState(prev => ({
      ...prev,
      players: prev.players.map(p => {
        if (p.id === playerId) {
          const newMarked = new Set(p.markedNumbers);
          if (newMarked.has(num)) newMarked.delete(num);
          else newMarked.add(num);
          return { ...p, markedNumbers: newMarked };
        }
        return p;
      })
    }));
  };

  const handleKinhCall = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    if (checkWin(me.ticket, me.markedNumbers)) {
      handleWin(me);
    } else {
      setGameState(prev => ({ ...prev, mcCommentary: 'Khoan đã! Bạn chưa đủ điều kiện KINH đâu nhé! Kiểm tra lại đi.' }));
    }
  };

  const handleWin = (winner: Player) => {
    setGameState(prev => ({
      ...prev,
      status: 'ended',
      winner: winner,
      mcCommentary: `CHÚC MỪNG! ${winner.name} ĐÃ KINH RỒI!`,
    }));
    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
  };

  const resetGame = () => {
    // Keep the same room, just reset game state
    setGameState(prev => ({
      ...prev,
      status: 'waiting',
      calledNumbers: [],
      currentNumber: null,
      winner: null,
      mcCommentary: 'Bắt đầu ván mới nào!',
      players: prev.players.map(p => ({
        ...p,
        markedNumbers: new Set(),
        ticket: generateTicket(), // New ticket for everyone
      }))
    }));
  };

  // Render Helpers
  const me = gameState.players.find(p => p.id === playerId);
  const isHost = me?.isHost;

  if (gameState.status === 'lobby') {
    return <Lobby onCreateRoom={createRoom} isCreating={false} />;
  }

  return (
    <div className="min-h-screen bg-red-50 text-gray-800 pb-12">
      {/* Header */}
      <header className="bg-red-600 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Trophy className="h-6 w-6 text-yellow-300" />
            <span className="font-bold text-xl">Loto Vui</span>
          </div>
          <div className="text-sm font-medium bg-red-700 px-3 py-1 rounded-full">
            Phòng: {gameState.code}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        
        {/* Status Area */}
        {gameState.status === 'waiting' && (
          <div className="bg-white p-6 rounded-xl shadow-md text-center space-y-4">
            <h2 className="text-2xl font-bold text-gray-700">Phòng Chờ (Waiting Room)</h2>
            <div className="flex flex-wrap justify-center gap-4">
              {gameState.players.map(p => (
                <div key={p.id} className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-full border border-gray-200">
                   <div className={`w-3 h-3 rounded-full ${p.isBot ? 'bg-blue-400' : 'bg-green-500'}`}></div>
                   <span className="font-medium">{p.name}</span>
                </div>
              ))}
            </div>
            {isHost && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-4">
                  <button 
                    onClick={addBot}
                    className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-transform active:scale-95"
                  >
                    <UserPlus size={20} />
                    Thêm Bot
                  </button>
                  <button 
                    onClick={startGame}
                    disabled={gameState.players.length < 2}
                    className="bg-red-500 hover:bg-red-600 disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:scale-105 active:scale-95 disabled:scale-100 disabled:cursor-not-allowed"
                  >
                    {gameState.players.length < 2 ? `Cần thêm người chơi` : `BẮT ĐẦU (START)`}
                  </button>
              </div>
            )}
            {!isHost && <p className="text-gray-400 italic">Chờ chủ phòng bắt đầu...</p>}
          </div>
        )}

        {/* Game Area */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div className="space-y-6">
            
            {/* Caller Section */}
            <div className="bg-gradient-to-r from-orange-100 to-red-100 p-6 rounded-2xl shadow-inner border-2 border-orange-200 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-400 to-transparent animate-pulse"></div>
              
              <div className="mb-2 text-red-500 font-semibold flex items-center justify-center gap-2">
                 <Volume2 className="w-5 h-5" />
                 <span>MC Gemini</span>
              </div>
              
              <div className="min-h-[60px] flex items-center justify-center">
                 {mcLoading ? (
                    <span className="text-gray-400 italic">Đang suy nghĩ câu vè...</span>
                 ) : (
                    <p className="text-xl md:text-2xl text-gray-800 font-serif italic">"{gameState.mcCommentary}"</p>
                 )}
              </div>

              {gameState.currentNumber && (
                <div className="mt-4">
                  <div className="inline-flex items-center justify-center w-24 h-24 bg-red-600 text-white text-5xl font-extrabold rounded-full shadow-xl border-4 border-yellow-400 animate-bounce">
                    {gameState.currentNumber}
                  </div>
                </div>
              )}
            </div>

            {/* Layout: Ticket Left (or Top), Sidebar Right (or Bottom) */}
            <div className="grid lg:grid-cols-3 gap-6">
              
              {/* Main Column: Ticket */}
              <div className="lg:col-span-2 space-y-6">
                  {/* Player Ticket */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <UserCircle2 className="w-5 h-5" /> 
                            Vé của bạn ({me?.name})
                        </h3>
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                            <Info size={14} />
                            Nhấn vào số để đánh dấu
                        </div>
                    </div>
                    {me && (
                    <Ticket 
                        ticket={me.ticket} 
                        markedNumbers={me.markedNumbers} 
                        onNumberClick={handleMarkNumber}
                        disabled={gameState.status === 'ended'}
                    />
                    )}
                    
                    {gameState.status === 'playing' && (
                        <button
                            onClick={handleKinhCall}
                            className="w-full mt-4 bg-yellow-400 hover:bg-yellow-500 text-red-800 font-black text-xl py-4 rounded-xl shadow-lg border-b-4 border-yellow-600 active:border-b-0 active:translate-y-1 transition-all uppercase tracking-widest"
                        >
                            KINH RỒI! (BINGO)
                        </button>
                    )}
                  </div>
              </div>

              {/* Sidebar Column: Board & Players */}
              <div className="space-y-6">
                 {/* Called Numbers Board */}
                 <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={gameState.currentNumber} />

                 {/* Player List */}
                 <div className="bg-white p-4 rounded-xl shadow-md border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center">
                        <Users className="w-5 h-5 mr-2 text-blue-500" />
                        Người Chơi ({gameState.players.length})
                    </h3>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                        {gameState.players.map(p => {
                             const markedCount = p.markedNumbers.size;
                             return (
                                <div key={p.id} className={`flex items-center justify-between p-2 rounded-lg text-sm ${p.id === playerId ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${p.isBot ? 'bg-blue-400' : 'bg-green-500'}`}></div>
                                        <span className={`font-medium ${p.id === playerId ? 'text-gray-900' : 'text-gray-600'}`}>
                                            {p.name} {p.isHost && '👑'}
                                        </span>
                                    </div>
                                    <div className="text-gray-400 text-xs">
                                        {markedCount} số
                                    </div>
                                </div>
                             )
                        })}
                    </div>
                 </div>
              </div>

            </div>
            
            {/* Winner Overlay */}
            {gameState.status === 'ended' && gameState.winner && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl scale-100 animate-in zoom-in-95 duration-300">
                  <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Trophy className="w-10 h-10 text-yellow-600" />
                  </div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">CHIẾN THẮNG!</h2>
                  <p className="text-gray-600 text-lg mb-6">
                    Người chiến thắng là <span className="font-bold text-red-600">{gameState.winner.name}</span>
                  </p>
                  
                  {isHost && (
                      <button 
                        onClick={resetGame}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors"
                      >
                        Chơi ván mới
                      </button>
                  )}
                  {!isHost && <p>Chờ chủ phòng bắt đầu lại...</p>}
                </div>
              </div>
            )}

          </div>
        )}
      </main>
    </div>
  );
};

export default App;