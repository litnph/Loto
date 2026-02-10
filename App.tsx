import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// Prefix helps avoid collisions on the public PeerServer
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
  
  // Refs for network management
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const hostConnRef = useRef<DataConnection | null>(null);
  const callIntervalRef = useRef<any>(null);

  // --- Network Helpers ---

  // Host sends data to all connected guests
  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }, []);

  // Host syncs the entire game state to guests
  // Must convert Sets to Arrays because JSON cannot serialize Sets
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

  // --- Cleanup on Unmount ---
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
    
    // Generate a simple 5-char code
    const shortCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const fullRoomId = ROOM_PREFIX + shortCode;

    // Create Peer as Host
    const peer = new Peer(fullRoomId, {
      debug: 1,
    });

    peer.on('open', (id) => {
      console.log('Host created with ID:', id);
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
      console.log('Guest connecting:', conn.peer);
      
      conn.on('data', (data: any) => {
        handleHostReceivedData(data, conn);
      });

      conn.on('open', () => {
         connectionsRef.current.push(conn);
      });

      conn.on('close', () => {
         // Remove connection
         connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
         
         // Remove player from game state
         setGameState(prev => {
            const updatedPlayers = prev.players.filter(p => p.peerId !== conn.peer);
            const newState = { ...prev, players: updatedPlayers };
            // Need to sync this change to remaining guests
            // We use setTimeout to ensure state update has processed or just pass the derived state
            // Passing derived state 'newState' to sync function is safer
            // Note: We need to wrap sync in a small timeout or call it directly with the object
            // However, syncStateToGuests relies on closure or args. Let's make a helper that takes state.
            
            // Hack: trigger sync after state update
            setTimeout(() => {
                // We must reconstruct the payload manually here because we can't easily access the fresh state inside this callback immediately
                // Actually, 'newState' IS the fresh state.
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
      console.error('Peer Error:', err);
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
    
    // Guest just needs a random ID
    const peer = new Peer();

    // Timeout if connection takes too long
    const connectionTimeout = setTimeout(() => {
        if (isConnecting) {
            setConnectionError("Không tìm thấy phòng hoặc kết nối quá lâu. Vui lòng kiểm tra mã phòng.");
            setIsConnecting(false);
            peer.destroy();
        }
    }, 8000);

    peer.on('open', (id) => {
      setPlayerId(id);
      
      const conn = peer.connect(fullRoomId, {
         reliable: true
      });

      conn.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log("Connected to Host successfully");
        setIsConnecting(false);
        hostConnRef.current = conn;

        // Immediately send join request
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

      conn.on('data', (data: any) => {
        handleGuestReceivedData(data);
      });

      conn.on('close', () => {
        alert("Kết nối với chủ phòng bị ngắt!");
        window.location.reload();
      });

      conn.on('error', (err) => {
          console.error("Connection error:", err);
      });
    });

    peer.on('error', (err) => {
        clearTimeout(connectionTimeout);
        console.error("Guest Peer Error:", err);
        setIsConnecting(false);
        setConnectionError('Lỗi kết nối máy chủ Peer.');
    });

    peerRef.current = peer;
  };

  // --- Data Handling Logic ---

  const handleHostReceivedData = (data: any, conn: DataConnection) => {
      if (data.type === 'JOIN_REQUEST') {
          setGameState(prev => {
              // Prevent duplicate joins from same ID
              if (prev.players.some(p => p.id === data.player.id)) return prev;

              const newPlayer: Player = {
                  ...data.player,
                  // Important: Restore Set from Array
                  markedNumbers: new Set<number>(data.player.markedNumbers) 
              };
              
              const newState = {
                  ...prev,
                  players: [...prev.players, newPlayer]
              };
              
              // Sync everyone immediately
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
          // Guest marked a number, Host updates truth
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
             // Optional: Sync back to ensure consistency? 
             // Ideally yes, but to save bandwidth we can trust guests slightly or sync on next draw.
             // Let's sync to ensure others see the progress (e.g. "X has 3 numbers")
             // To avoid spam, maybe only sync if it's a winning move? 
             // For now, let's NOT sync immediately on every mark to avoid stutter, 
             // the numbers will sync on next draw call anyway.
             return newState;
          });
      } 
      else if (data.type === 'BINGO_CLAIM') {
          // Guest claims victory
          setGameState(prev => {
            const player = prev.players.find(p => p.id === data.playerId);
            if (player) {
                const claimedMarked = new Set<number>(data.markedNumbers);
                // Verify against Host's called numbers logic could be added here for extra security
                if (checkWin(player.ticket, claimedMarked)) {
                    // It's a win!
                    const newState = {
                        ...prev,
                        status: 'ended' as GameStatus,
                        winner: player,
                        mcCommentary: `CHÚC MỪNG! ${player.name} ĐÃ KINH RỒI!`,
                    };
                    
                    // Broadcast win immediately
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
                    
                    // Stop game loop
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
          // Hydrate players: Convert Array back to Set
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

  // --- Game Loop (Host Only) ---

  const startGame = useCallback(() => {
    setGameState(prev => {
        const newState = {
            ...prev,
            status: 'playing' as GameStatus,
            mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
        };
        // Use a direct payload construction to avoid closure staleness
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

      // Sync
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

  // Interval for drawing numbers (Host only)
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

  // AI Commentary (Host only)
  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me?.isHost && gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        
        setGameState(prev => {
            const newState = { ...prev, mcCommentary: text };
            // Sync commentary update
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


  // --- User Interaction ---

  const handleMarkNumber = (num: number) => {
    if (gameState.status !== 'playing') return;
    
    if (!gameState.calledNumbers.includes(num)) {
      alert("Số này chưa được gọi!");
      return;
    }

    // Determine the player instance from the current state
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    // Optimistic Update: Calculate the new marked set based on the current state
    // We calculate this outside setGameState so we can use it for the network call too
    const newMarked = new Set<number>(me.markedNumbers);
    if (newMarked.has(num)) newMarked.delete(num);
    else newMarked.add(num);

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked } : p
      );

      return {
          ...prev,
          players: updatedPlayers
      };
    });

    // Send update to Host
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
            // Host wins locally
             setGameState(prev => {
                    const newState = {
                        ...prev,
                        status: 'ended' as GameStatus,
                        winner: me,
                        mcCommentary: `CHÚC MỪNG! ${me.name} ĐÃ KINH RỒI!`,
                    };
                    // Sync win
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
            // Guest sends claim
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

  // --- Rendering ---

  const me = gameState.players.find(p => p.id === playerId);
  const isHost = me?.isHost;

  if (gameState.status === 'lobby') {
    return (
        <>
            <Lobby onCreateRoom={createRoom} onJoinRoom={joinRoom} isCreating={isConnecting} />
            {connectionError && (
                <div className="fixed top-5 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50 animate-bounce">
                    <strong className="font-bold">Lỗi: </strong>
                    <span className="block sm:inline">{connectionError}</span>
                </div>
            )}
        </>
    );
  }

  return (
    <div className="min-h-screen bg-red-50 text-gray-800 pb-12">
      {/* Header */}
      <header className="bg-red-600 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Trophy className="h-6 w-6 text-yellow-300" />
            <span className="font-bold text-xl">Loto Vui Online</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium bg-red-700 px-3 py-1 rounded-full">
            {isConnecting ? <WifiOff size={16} /> : <Wifi size={16} className="text-green-300"/>}
            Phòng: {gameState.code}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        
        {/* Status Area */}
        {gameState.status === 'waiting' && (
          <div className="bg-white p-6 rounded-xl shadow-md text-center space-y-4">
            <h2 className="text-2xl font-bold text-gray-700">Phòng Chờ</h2>
            <div className="p-4 bg-gray-100 rounded-lg inline-block">
                <p className="text-gray-500 mb-1">Mã Phòng:</p>
                <p className="font-mono font-bold text-4xl text-red-600 tracking-wider select-all">{gameState.code}</p>
            </div>
            
            <div className="flex flex-wrap justify-center gap-4 py-4">
              {gameState.players.map(p => (
                <div key={p.id} className="flex items-center space-x-2 bg-white border-2 border-green-100 px-4 py-2 rounded-full shadow-sm animate-in fade-in zoom-in">
                   <div className="w-3 h-3 rounded-full bg-green-500"></div>
                   <span className="font-bold text-gray-700">{p.name}</span>
                   {p.isHost && <span className="text-yellow-500" title="Chủ phòng">👑</span>}
                </div>
              ))}
            </div>

            {isHost ? (
              <div className="flex justify-center mt-4">
                  <button 
                    onClick={() => startGame()}
                    disabled={gameState.players.length < 2}
                    className="bg-red-500 hover:bg-red-600 disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-3 px-12 rounded-full shadow-lg transform transition hover:scale-105 active:scale-95 disabled:scale-100 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {gameState.players.length < 2 ? 'Đợi người chơi khác...' : <><Play size={20}/> BẮT ĐẦU</>}
                  </button>
              </div>
            ) : (
                <div className="flex flex-col items-center gap-2 text-gray-500 italic mt-4">
                    <Loader2 className="animate-spin text-red-500 w-8 h-8" />
                    <p>Đang chờ chủ phòng bắt đầu...</p>
               </div>
            )}
          </div>
        )}

        {/* Game Area */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div className="space-y-6">
            
            {/* Caller Section */}
            <div className="bg-gradient-to-r from-orange-100 to-red-100 p-6 rounded-2xl shadow-inner border-2 border-orange-200 text-center relative overflow-hidden">
              <div className="mb-2 text-red-500 font-semibold flex items-center justify-center gap-2">
                 <Volume2 className="w-5 h-5" />
                 <span>MC Gemini</span>
              </div>
              
              <div className="min-h-[80px] flex items-center justify-center px-4">
                 {mcLoading ? (
                    <span className="text-gray-400 italic flex items-center gap-2">
                        <Loader2 className="animate-spin w-4 h-4" /> Đang nghĩ câu vè...
                    </span>
                 ) : (
                    <p className="text-xl md:text-2xl text-gray-800 font-serif italic leading-relaxed">
                        "{gameState.mcCommentary}"
                    </p>
                 )}
              </div>

              {gameState.currentNumber && (
                <div className="mt-6 mb-2">
                  <div className="inline-flex items-center justify-center w-28 h-28 bg-red-600 text-white text-6xl font-extrabold rounded-full shadow-xl border-4 border-yellow-400 animate-bounce">
                    {gameState.currentNumber}
                  </div>
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              
              {/* Ticket */}
              <div className="lg:col-span-2 space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                            <UserCircle2 className="w-6 h-6 text-red-500" /> 
                            Vé Loto Của Bạn ({me?.name})
                        </h3>
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
                            className="w-full mt-6 bg-yellow-400 hover:bg-yellow-500 text-red-900 font-black text-2xl py-4 rounded-xl shadow-lg border-b-8 border-yellow-600 active:border-b-0 active:translate-y-2 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                            <Trophy className="w-8 h-8" />
                            KINH RỒI! (BINGO)
                        </button>
                    )}
                  </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                 <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={gameState.currentNumber} />

                 <div className="bg-white p-4 rounded-xl shadow-md border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center">
                        <Users className="w-5 h-5 mr-2 text-blue-500" />
                        Người Chơi ({gameState.players.length})
                    </h3>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                        {gameState.players.map(p => {
                             const markedCount = p.markedNumbers.size;
                             return (
                                <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${p.id === playerId ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold shadow-sm">
                                            {p.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className={`font-bold ${p.id === playerId ? 'text-gray-900' : 'text-gray-600'}`}>
                                                {p.name}
                                            </span>
                                            {p.isHost && <span className="text-xs text-yellow-600 font-semibold">Chủ phòng</span>}
                                        </div>
                                    </div>
                                    <div className="text-gray-500 font-mono bg-white px-2 py-1 rounded border border-gray-200 text-xs">
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
              <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-in fade-in duration-300 backdrop-blur-sm">
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl scale-100 animate-in zoom-in-95 duration-300 border-4 border-yellow-400">
                  <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                    <Trophy className="w-12 h-12 text-yellow-600" />
                  </div>
                  <h2 className="text-4xl font-extrabold text-red-600 mb-2 uppercase tracking-wide">Chiến Thắng!</h2>
                  <p className="text-gray-600 text-lg mb-8">
                    Chúc mừng <span className="font-bold text-gray-900 text-xl">{gameState.winner.name}</span> đã Kinh!
                  </p>
                  
                  {isHost ? (
                      <button 
                        onClick={resetGame}
                        className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white font-bold py-4 rounded-xl shadow-lg transition-transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-5 h-5" />
                        Chơi Ván Mới
                      </button>
                  ) : (
                      <div className="flex items-center justify-center gap-2 text-gray-500">
                          <Loader2 className="animate-spin w-4 h-4" />
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