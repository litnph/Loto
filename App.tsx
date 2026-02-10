import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

const ROOM_PREFIX = 'loto-vui-vn-v2-';

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
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const hostConnRef = useRef<DataConnection | null>(null);
  const callIntervalRef = useRef<any>(null);

  // --- Network Helpers ---
  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }, []);

  const syncStateToGuests = useCallback((currentState: RoomState) => {
    const payload = {
      type: 'SYNC_STATE',
      state: {
        ...currentState,
        players: currentState.players.map(p => ({
          ...p,
          markedNumbers: Array.from(p.markedNumbers)
        }))
      }
    };
    broadcast(payload);
  }, [broadcast]);

  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
    };
  }, []);

  // --- Game Actions ---
  const createRoom = async (playerName: string) => {
    setIsConnecting(true);
    setConnectionError('');
    
    const shortCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const fullRoomId = ROOM_PREFIX + shortCode;

    const peer = new Peer(fullRoomId, { debug: 1 });

    peer.on('open', (id) => {
      const myTicket = generateTicket();
      const hostPlayer: Player = {
        id: id,
        name: playerName,
        isHost: true,
        isBot: false,
        ticket: myTicket,
        markedNumbers: new Set(),
        peerId: id
      };

      setPlayerId(id);
      setGameState({
        code: shortCode,
        players: [hostPlayer],
        status: 'waiting',
        calledNumbers: [],
        currentNumber: null,
        winner: null,
        mcCommentary: 'Chào mừng! Chia sẻ mã phòng cho bạn bè để bắt đầu.',
      });
      setIsConnecting(false);
    });

    peer.on('connection', (conn) => {
      conn.on('data', (data: any) => {
        handleHostReceivedData(data, conn);
      });

      conn.on('open', () => {
         connectionsRef.current.push(conn);
      });

      conn.on('close', () => {
         connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
         setGameState(prev => {
            const updatedPlayers = prev.players.filter(p => p.peerId !== conn.peer);
            const newState = { ...prev, players: updatedPlayers };
            setTimeout(() => {
                const payload = {
                    type: 'SYNC_STATE',
                    state: {
                        ...newState,
                        players: newState.players.map(p => ({
                        ...p,
                        markedNumbers: Array.from(p.markedNumbers)
                        }))
                    }
                };
                connectionsRef.current.forEach(c => c.open && c.send(payload));
            }, 100);
            return newState;
         });
      });
    });

    peer.on('error', (err) => {
      setIsConnecting(false);
      if (err.type === 'unavailable-id') {
         setConnectionError('Mã phòng bị trùng. Vui lòng thử lại.');
      } else {
         setConnectionError(`Lỗi tạo phòng: ${err.type}`);
      }
    });
    peerRef.current = peer;
  };

  const joinRoom = (playerName: string, roomCode: string) => {
    setIsConnecting(true);
    setConnectionError('');
    const fullRoomId = ROOM_PREFIX + roomCode.toUpperCase();
    const peer = new Peer();

    const connectionTimeout = setTimeout(() => {
        if (isConnecting) {
            setConnectionError("Không tìm thấy phòng hoặc kết nối quá lâu. Vui lòng kiểm tra mã phòng.");
            setIsConnecting(false);
            peer.destroy();
        }
    }, 8000);

    peer.on('open', (id) => {
      setPlayerId(id);
      const conn = peer.connect(fullRoomId, { reliable: true });

      conn.on('open', () => {
        clearTimeout(connectionTimeout);
        setIsConnecting(false);
        hostConnRef.current = conn;

        const myTicket = generateTicket();
        const joinPayload = {
            type: 'JOIN_REQUEST',
            player: {
                id: id,
                name: playerName,
                isHost: false,
                isBot: false,
                ticket: myTicket,
                markedNumbers: [], 
                peerId: id
            }
        };
        conn.send(joinPayload);
      });

      conn.on('data', (data: any) => handleGuestReceivedData(data));
      conn.on('close', () => {
        alert("Kết nối với chủ phòng bị ngắt!");
        window.location.reload();
      });
    });

    peer.on('error', (err) => {
        clearTimeout(connectionTimeout);
        setIsConnecting(false);
        setConnectionError('Lỗi kết nối máy chủ Peer.');
    });
    peerRef.current = peer;
  };

  // --- Data Handling ---
  const handleHostReceivedData = (data: any, conn: DataConnection) => {
      if (data.type === 'JOIN_REQUEST') {
          setGameState(prev => {
              if (prev.players.some(p => p.id === data.player.id)) return prev;
              const newPlayer: Player = {
                  ...data.player,
                  markedNumbers: new Set<number>(data.player.markedNumbers) 
              };
              const newState = {
                  ...prev,
                  players: [...prev.players, newPlayer]
              };
              setTimeout(() => {
                  const payload = {
                    type: 'SYNC_STATE',
                    state: {
                        ...newState,
                        players: newState.players.map(p => ({
                        ...p,
                        markedNumbers: Array.from(p.markedNumbers)
                        }))
                    }
                  };
                  connectionsRef.current.forEach(c => c.open && c.send(payload));
              }, 50);
              return newState;
          });
      } 
      else if (data.type === 'MARK_UPDATE') {
          setGameState(prev => {
             const newState = {
                 ...prev,
                 players: prev.players.map(p => {
                     if (p.id === data.playerId) {
                         return { ...p, markedNumbers: new Set<number>(data.markedNumbers) };
                     }
                     return p;
                 })
             };
             return newState;
          });
      } 
      else if (data.type === 'BINGO_CLAIM') {
          setGameState(prev => {
            const player = prev.players.find(p => p.id === data.playerId);
            if (player) {
                const claimedMarked = new Set<number>(data.markedNumbers);
                if (checkWin(player.ticket, claimedMarked)) {
                    const newState = {
                        ...prev,
                        status: 'ended' as GameStatus,
                        winner: player,
                        mcCommentary: `CHÚC MỪNG! ${player.name} ĐÃ KINH RỒI!`,
                    };
                    setTimeout(() => {
                         const payload = {
                            type: 'SYNC_STATE',
                            state: {
                                ...newState,
                                players: newState.players.map(p => ({
                                ...p,
                                markedNumbers: Array.from(p.markedNumbers)
                                }))
                            }
                        };
                        connectionsRef.current.forEach(c => c.open && c.send(payload));
                    }, 0);
                    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
                    return newState;
                }
            }
            return prev;
          });
      }
  };

  const handleGuestReceivedData = (data: any) => {
      if (data.type === 'SYNC_STATE') {
          const remoteState = data.state;
          const hydratedPlayers = remoteState.players.map((p: any) => ({
              ...p,
              markedNumbers: new Set<number>(p.markedNumbers)
          }));
          setGameState({
              ...remoteState,
              players: hydratedPlayers,
          });
      }
  };

  // --- Game Loop ---
  const startGame = useCallback(() => {
    setGameState(prev => {
        const newState = {
            ...prev,
            status: 'playing' as GameStatus,
            mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
        };
        const payload = {
            type: 'SYNC_STATE',
            state: {
                ...newState,
                players: newState.players.map(p => ({
                    ...p,
                    markedNumbers: Array.from(p.markedNumbers)
                }))
            }
        };
        connectionsRef.current.forEach(c => c.open && c.send(payload));
        return newState;
    });
  }, []);

  const drawNumber = useCallback(async () => {
    setGameState(prev => {
      if (prev.status !== 'playing' || prev.calledNumbers.length >= TOTAL_NUMBERS) return prev;
      const available = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1)
        .filter(n => !prev.calledNumbers.includes(n));
      if (available.length === 0) return prev;
      const nextNum = available[Math.floor(Math.random() * available.length)];
      
      const newState = {
        ...prev,
        currentNumber: nextNum,
        calledNumbers: [...prev.calledNumbers, nextNum],
      };

      const payload = {
        type: 'SYNC_STATE',
        state: {
            ...newState,
            players: newState.players.map(p => ({
                ...p,
                markedNumbers: Array.from(p.markedNumbers)
            }))
        }
      };
      connectionsRef.current.forEach(c => c.open && c.send(payload));
      return newState;
    });
  }, []);

  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me?.isHost && gameState.status === 'playing' && !gameState.winner) {
      callIntervalRef.current = setInterval(() => {
        drawNumber();
      }, CALL_INTERVAL_MS);
    }
    return () => {
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
    };
  }, [gameState.status, gameState.winner, gameState.players, playerId, drawNumber]);

  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me?.isHost && gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        setGameState(prev => {
            const newState = { ...prev, mcCommentary: text };
            const payload = {
                type: 'SYNC_STATE',
                state: {
                    ...newState,
                    players: newState.players.map(p => ({
                        ...p,
                        markedNumbers: Array.from(p.markedNumbers)
                    }))
                }
            };
            connectionsRef.current.forEach(c => c.open && c.send(payload));
            return newState;
        });
        setMcLoading(false);
      };
      fetchCommentary();
    }
  }, [gameState.currentNumber, gameState.status, playerId]);

  // --- Interaction ---
  const handleMarkNumber = (num: number) => {
    if (gameState.status !== 'playing') return;
    if (!gameState.calledNumbers.includes(num)) {
      alert("Số này chưa được gọi!");
      return;
    }
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    const newMarked = new Set<number>(me.markedNumbers);
    if (newMarked.has(num)) newMarked.delete(num);
    else newMarked.add(num);

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked } : p
      );
      return { ...prev, players: updatedPlayers };
    });

    if (!me.isHost && hostConnRef.current) {
        hostConnRef.current.send({
            type: 'MARK_UPDATE',
            playerId: playerId,
            markedNumbers: Array.from(newMarked)
        });
    }
  };

  const handleKinhCall = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    if (checkWin(me.ticket, me.markedNumbers)) {
        if (me.isHost) {
             setGameState(prev => {
                    const newState = {
                        ...prev,
                        status: 'ended' as GameStatus,
                        winner: me,
                        mcCommentary: `CHÚC MỪNG! ${me.name} ĐÃ KINH RỒI!`,
                    };
                    const payload = {
                        type: 'SYNC_STATE',
                        state: {
                            ...newState,
                            players: newState.players.map(p => ({
                                ...p,
                                markedNumbers: Array.from(p.markedNumbers)
                            }))
                        }
                    };
                    connectionsRef.current.forEach(c => c.open && c.send(payload));
                    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
                    return newState;
            });
        } else {
            if (hostConnRef.current) {
                hostConnRef.current.send({
                    type: 'BINGO_CLAIM',
                    playerId: playerId,
                    markedNumbers: Array.from(me.markedNumbers)
                });
            }
        }
    } else {
      alert('Khoan đã! Bạn chưa đủ điều kiện KINH đâu nhé! Kiểm tra lại đi.');
    }
  };

  const resetGame = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me?.isHost) return;

    setGameState(prev => {
        const newState: RoomState = {
            ...prev,
            status: 'waiting',
            calledNumbers: [],
            currentNumber: null,
            winner: null,
            mcCommentary: 'Bắt đầu ván mới nào!',
            players: prev.players.map(p => ({
                ...p,
                markedNumbers: new Set()
            }))
        };
        const payload = {
            type: 'SYNC_STATE',
            state: {
                ...newState,
                players: newState.players.map(p => ({
                    ...p,
                    markedNumbers: Array.from(p.markedNumbers)
                }))
            }
        };
        connectionsRef.current.forEach(c => c.open && c.send(payload));
        return newState;
    });
  };

  // --- Render ---
  const me = gameState.players.find(p => p.id === playerId);
  const isHost = me?.isHost;

  if (gameState.status === 'lobby') {
    return (
        <>
            <Lobby onCreateRoom={createRoom} onJoinRoom={joinRoom} isCreating={isConnecting} />
            {connectionError && (
                <div style={{position: 'fixed', top: '20px', right: '20px', background: '#fee2e2', color: '#b91c1c', padding: '1rem', borderRadius: '8px', border: '1px solid #fca5a5', zIndex: 100}}>
                    <strong>Lỗi: </strong> {connectionError}
                </div>
            )}
        </>
    );
  }

  return (
    <div>
      <header className="app-header">
        <div className="header-content">
          <div className="brand">
            <Trophy size={24} style={{color: '#fcd34d'}} />
            <span>Loto Vui Online</span>
          </div>
          <div className="room-badge">
            {isConnecting ? <WifiOff size={16} /> : <Wifi size={16} style={{color: '#86efac'}}/>}
            Phòng: {gameState.code}
          </div>
        </div>
      </header>

      <main className="container">
        
        {/* Waiting Room */}
        {gameState.status === 'waiting' && (
          <div className="card text-center">
            <h2 style={{fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem'}}>Phòng Chờ</h2>
            <div style={{background: '#f3f4f6', padding: '1rem', borderRadius: '8px', display: 'inline-block', marginBottom: '1.5rem'}}>
                <p style={{color: '#6b7280', marginBottom: '0.25rem'}}>Mã Phòng:</p>
                <p style={{fontSize: '2rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#dc2626'}}>{gameState.code}</p>
            </div>
            
            <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1rem', marginBottom: '2rem'}}>
              {gameState.players.map(p => (
                <div key={p.id} className="player-item" style={{display: 'inline-flex', width: 'auto'}}>
                   <div style={{width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', marginRight: '8px'}}></div>
                   <span style={{fontWeight: 'bold'}}>{p.name}</span>
                   {p.isHost && <span style={{marginLeft: '4px'}}>👑</span>}
                </div>
              ))}
            </div>

            {isHost ? (
              <div className="flex justify-center">
                  <button 
                    onClick={() => startGame()}
                    disabled={gameState.players.length < 2}
                    className="btn btn-primary"
                    style={{padding: '1rem 3rem', fontSize: '1.2rem'}}
                  >
                    {gameState.players.length < 2 ? 'Đợi người chơi khác...' : <><Play size={20}/> BẮT ĐẦU</>}
                  </button>
              </div>
            ) : (
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#6b7280', gap: '0.5rem'}}>
                    <Loader2 className="animate-spin" style={{color: '#dc2626'}} />
                    <p>Đang chờ chủ phòng bắt đầu...</p>
               </div>
            )}
          </div>
        )}

        {/* Play Area */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
            
            {/* MC Section */}
            <div className="mc-section">
              <div className="mc-title">
                 <Volume2 size={20} />
                 <span>MC Gemini</span>
              </div>
              
              <div style={{minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                 {mcLoading ? (
                    <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                        <Loader2 className="animate-spin" size={16} /> Đang nghĩ câu vè...
                    </span>
                 ) : (
                    <p className="mc-text">"{gameState.mcCommentary}"</p>
                 )}
              </div>

              {gameState.currentNumber && (
                <div className="current-number">
                    {gameState.currentNumber}
                </div>
              )}
            </div>

            <div className="grid-layout">
              {/* Ticket Area */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
                        <UserCircle2 size={24} style={{color: '#dc2626'}} /> 
                        <h3 className="font-bold" style={{fontSize: '1.25rem'}}>Vé Của Bạn ({me?.name})</h3>
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
                            className="btn btn-warning w-full"
                            style={{marginTop: '1.5rem', fontSize: '1.25rem', padding: '1rem'}}
                        >
                            <Trophy size={28} />
                            KINH RỒI! (BINGO)
                        </button>
                    )}
                  </div>
              </div>

              {/* Sidebar */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                 <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={gameState.currentNumber} />

                 <div className="card" style={{padding: '1rem'}}>
                    <h3 className="font-bold" style={{marginBottom: '0.75rem', display: 'flex', alignItems: 'center'}}>
                        <Users size={20} style={{marginRight: '0.5rem', color: '#3b82f6'}} />
                        Người Chơi ({gameState.players.length})
                    </h3>
                    <div className="player-list custom-scrollbar">
                        {gameState.players.map(p => {
                             const markedCount = p.markedNumbers.size;
                             return (
                                <div key={p.id} className={`player-item ${p.id === playerId ? 'is-me' : ''}`}>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                                        <div className="avatar">
                                            {p.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div style={{display: 'flex', flexDirection: 'column'}}>
                                            <span style={{fontWeight: 'bold', color: p.id === playerId ? 'black' : '#4b5563'}}>
                                                {p.name}
                                            </span>
                                            {p.isHost && <span style={{fontSize: '0.75rem', color: '#ca8a04'}}>Chủ phòng</span>}
                                        </div>
                                    </div>
                                    <div style={{fontSize: '0.75rem', padding: '2px 6px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '4px'}}>
                                        {markedCount} số
                                    </div>
                                </div>
                             )
                        })}
                    </div>
                 </div>
              </div>

            </div>
            
            {/* Winner Modal */}
            {gameState.status === 'ended' && gameState.winner && (
              <div className="overlay">
                <div className="modal animate-in fade-in zoom-in">
                  <div className="modal-icon animate-bounce">
                    <Trophy size={48} style={{color: '#ca8a04'}} />
                  </div>
                  <h2 style={{fontSize: '2.25rem', fontWeight: '800', color: '#dc2626', marginBottom: '0.5rem', textTransform: 'uppercase'}}>Chiến Thắng!</h2>
                  <p style={{color: '#4b5563', fontSize: '1.125rem', marginBottom: '2rem'}}>
                    Chúc mừng <span style={{fontWeight: 'bold', color: 'black'}}>{gameState.winner.name}</span> đã Kinh!
                  </p>
                  
                  {isHost ? (
                      <button 
                        onClick={resetGame}
                        className="btn btn-primary w-full"
                        style={{padding: '1rem', fontSize: '1.1rem'}}
                      >
                        <RefreshCw size={20} />
                        Chơi Ván Mới
                      </button>
                  ) : (
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#6b7280'}}>
                          <Loader2 className="animate-spin" size={16} />
                          <span>Chờ chủ phòng bắt đầu lại...</span>
                      </div>
                  )}
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