import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, Info, UserCircle2, Loader2, Wifi, WifiOff } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// Prefix to avoid random collision on public PeerServer
const ROOM_PREFIX = 'loto-vui-vn-';

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
  
  // Ref to hold the Peer instance
  const peerRef = useRef<Peer | null>(null);
  // Ref to hold connections to other players (if Host)
  const connectionsRef = useRef<DataConnection[]>([]);
  // Ref to hold connection to Host (if Guest)
  const hostConnRef = useRef<DataConnection | null>(null);

  const callIntervalRef = useRef<any>(null);

  // --- Network Helpers ---

  // Helper to send data to everyone (if Host)
  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }, []);

  // Helper to sync state to guests (convert Sets to Arrays for JSON transport)
  const syncStateToGuests = useCallback((currentState: RoomState) => {
    const payload = {
      type: 'SYNC_STATE',
      state: {
        ...currentState,
        // Convert Set to Array for transmission
        players: currentState.players.map(p => ({
          ...p,
          markedNumbers: Array.from(p.markedNumbers)
        }))
      }
    };
    broadcast(payload);
  }, [broadcast]);

  // --- Game Actions ---

  const createRoom = async (playerName: string) => {
    setIsConnecting(true);
    setConnectionError('');
    
    // Create short code for display
    const shortCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const fullRoomId = ROOM_PREFIX + shortCode;

    // Init Peer as Host
    const peer = new Peer(fullRoomId, {
      debug: 1,
    });

    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      const myTicket = generateTicket();
      const newPlayer: Player = {
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
        players: [newPlayer],
        status: 'waiting',
        calledNumbers: [],
        currentNumber: null,
        winner: null,
        mcCommentary: 'Chào mừng! Chia sẻ mã phòng cho bạn bè để bắt đầu.',
      });
      setIsConnecting(false);
    });

    peer.on('connection', (conn) => {
      console.log('Incoming connection from', conn.peer);
      
      conn.on('data', (data: any) => {
        handleHostReceivedData(data, conn);
      });

      conn.on('open', () => {
         // Keep track of connection
         connectionsRef.current.push(conn);
      });

      conn.on('close', () => {
         connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
         setGameState(prev => {
            const updatedPlayers = prev.players.filter(p => p.peerId !== conn.peer);
            const newState = { ...prev, players: updatedPlayers };
            // Notify others that someone left
            syncStateToGuests(newState); 
            return newState;
         });
      });
    });

    peer.on('error', (err) => {
      console.error(err);
      setIsConnecting(false);
      if (err.type === 'unavailable-id') {
         setConnectionError('Mã phòng bị trùng, vui lòng thử lại.');
      } else {
         setConnectionError('Lỗi kết nối: ' + err.type);
      }
    });

    peerRef.current = peer;
  };

  const joinRoom = (playerName: string, roomCode: string) => {
    setIsConnecting(true);
    setConnectionError('');
    
    const fullRoomId = ROOM_PREFIX + roomCode.toUpperCase();
    
    // Init Peer as Guest (random ID)
    const peer = new Peer();

    peer.on('open', (id) => {
      setPlayerId(id);
      console.log('Connected to PeerServer as ' + id);
      
      // Connect to Host
      const conn = peer.connect(fullRoomId, {
         reliable: true
      });

      conn.on('open', () => {
        console.log("Connected to Host");
        setIsConnecting(false);
        hostConnRef.current = conn;

        // Send Join Request
        const myTicket = generateTicket();
        const joinPayload = {
            type: 'JOIN_REQUEST',
            player: {
                id: id,
                name: playerName,
                isHost: false,
                isBot: false,
                ticket: myTicket,
                markedNumbers: [], // Send empty array
                peerId: id
            }
        };
        conn.send(joinPayload);
      });

      conn.on('data', (data: any) => {
        handleGuestReceivedData(data);
      });

      conn.on('close', () => {
        alert("Chủ phòng đã ngắt kết nối!");
        window.location.reload();
      });
      
      // Connection failure usually happens on 'error' of the peer, not conn
      conn.on('error', (err) => {
          console.error("Conn error", err);
      });
    });

    peer.on('error', (err) => {
        console.error("Peer error", err);
        setIsConnecting(false);
        setConnectionError('Không tìm thấy phòng hoặc lỗi kết nối.');
    });

    peerRef.current = peer;
  };

  // --- Data Handlers ---

  const handleHostReceivedData = (data: any, conn: DataConnection) => {
      if (data.type === 'JOIN_REQUEST') {
          setGameState(prev => {
              // Avoid duplicates
              if (prev.players.find(p => p.id === data.player.id)) return prev;

              const newPlayer: Player = {
                  ...data.player,
                  markedNumbers: new Set<number>(data.player.markedNumbers) // Convert Array back to Set
              };
              
              const newState = {
                  ...prev,
                  players: [...prev.players, newPlayer]
              };
              
              // Sync everyone immediately
              // We need to pass the newState because setGameState is async in React but we want to sync updated data
              // But inside this callback, we need to be careful. 
              // Better to use a timeout or invoke sync after state update effect? 
              // Simplest here is to invoke sync with the calculated new state.
              setTimeout(() => syncStateToGuests(newState), 100);
              
              return newState;
          });
      } else if (data.type === 'MARK_UPDATE') {
          // Guest marked a number, update host state to keep track
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
             // Optional: Sync back to everyone so they see progress? 
             // Maybe too much traffic. Let's only sync major events or periodically.
             return newState;
          });
      } else if (data.type === 'BINGO_CLAIM') {
          // Guest claims win
          const player = gameState.players.find(p => p.id === data.playerId);
          if (player) {
              const claimedMarked = new Set<number>(data.markedNumbers);
              if (checkWin(player.ticket, claimedMarked)) {
                  handleWin(player);
              } else {
                  // False claim
                  // Could send a message back, but simple for now
              }
          }
      }
  };

  const handleGuestReceivedData = (data: any) => {
      if (data.type === 'SYNC_STATE') {
          const remoteState = data.state;
          // Hydrate the state (Arrays to Sets)
          const hydratedPlayers = remoteState.players.map((p: any) => ({
              ...p,
              markedNumbers: new Set<number>(p.markedNumbers)
          }));
          
          setGameState({
              ...remoteState,
              players: hydratedPlayers,
              // Important: Keep my own ticket intact if needed, 
              // but Host is authority, so we accept Host's ticket for us usually.
              // In this logic, Host generated ticket for us on join (or we sent it).
              // The sync should be correct.
          });
      }
  };


  // --- Game Logic (Host Only) ---

  const startGame = useCallback(() => {
    setGameState(prev => {
        const newState = {
            ...prev,
            status: 'playing' as GameStatus,
            mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
        };
        syncStateToGuests(newState);
        return newState;
    });
  }, [syncStateToGuests]);

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

      // Sync state immediately with number
      syncStateToGuests(newState);
      return newState;
    });
  }, [syncStateToGuests]);

  // Host Loop
  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    // Only Host runs the loop
    if (me?.isHost && gameState.status === 'playing' && !gameState.winner) {
      callIntervalRef.current = setInterval(() => {
        drawNumber();
      }, CALL_INTERVAL_MS);
    }
    return () => {
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
    };
  }, [gameState.status, gameState.winner, gameState.players, playerId, drawNumber]);

  // Generate Commentary (Host Only) and sync via state
  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me?.isHost && gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        
        setGameState(prev => {
            const newState = { ...prev, mcCommentary: text };
            syncStateToGuests(newState);
            return newState;
        });
        setMcLoading(false);
      };
      fetchCommentary();
    }
  }, [gameState.currentNumber, gameState.status, playerId]); // removed gameState.players to avoid loop, checking inside


  // --- Player Actions ---

  const handleMarkNumber = (num: number) => {
    if (gameState.status !== 'playing') return;
    
    // Allow marking only if called
    if (!gameState.calledNumbers.includes(num)) {
      alert("Số này chưa được gọi!");
      return;
    }

    // Update Local State
    let newMarkedSet = new Set<number>();
    
    setGameState(prev => {
      const me = prev.players.find(p => p.id === playerId);
      if (!me) return prev;
      
      const newMarked = new Set(me.markedNumbers);
      if (newMarked.has(num)) newMarked.delete(num);
      else newMarked.add(num);
      newMarkedSet = newMarked;

      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked } : p
      );

      return {
          ...prev,
          players: updatedPlayers
      };
    });

    // Notify Host (if Guest)
    const me = gameState.players.find(p => p.id === playerId);
    if (me && !me.isHost && hostConnRef.current) {
        hostConnRef.current.send({
            type: 'MARK_UPDATE',
            playerId: playerId,
            markedNumbers: Array.from(newMarkedSet)
        });
    }
  };

  const handleKinhCall = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    if (checkWin(me.ticket, me.markedNumbers)) {
        if (me.isHost) {
            handleWin(me);
        } else {
            // Send claim to host
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

  const handleWin = (winner: Player) => {
    setGameState(prev => {
        const newState = {
            ...prev,
            status: 'ended' as GameStatus,
            winner: winner,
            mcCommentary: `CHÚC MỪNG! ${winner.name} ĐÃ KINH RỒI!`,
        };
        // If I am host, sync this
        if (prev.players.find(p => p.id === playerId)?.isHost) {
             syncStateToGuests(newState);
        }
        return newState;
    });
    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
  };

  const resetGame = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me?.isHost) return;

    setGameState(prev => {
        // Generate new tickets for everyone? 
        // For simplicity in P2P, we might ask everyone to re-join or just reset board.
        // Let's just reset numbers but keep tickets for now to avoid sync complexity of new tickets, 
        // OR generate new ticket for Host and ask Guests to regen?
        // Simplest: Reset board, keep tickets.
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
        syncStateToGuests(newState);
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
                <div className="fixed top-5 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50">
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
            <p className="text-gray-500">Mã phòng của bạn là: <span className="font-mono font-bold text-2xl text-red-600 select-all">{gameState.code}</span></p>
            
            <div className="flex flex-wrap justify-center gap-4 py-4">
              {gameState.players.map(p => (
                <div key={p.id} className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-full border border-gray-200 animate-in fade-in zoom-in">
                   <div className="w-3 h-3 rounded-full bg-green-500"></div>
                   <span className="font-medium">{p.name}</span>
                   {p.isHost && <span className="text-yellow-500">👑</span>}
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
                    {gameState.players.length < 2 ? 'Đợi thêm người chơi...' : <><Play size={20}/> BẮT ĐẦU</>}
                  </button>
              </div>
            ) : (
                <div className="flex flex-col items-center gap-2 text-gray-500 italic mt-4">
                    <Loader2 className="animate-spin text-red-500" />
                    Đang chờ chủ phòng bắt đầu...
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

            <div className="grid lg:grid-cols-3 gap-6">
              
              {/* Ticket */}
              <div className="lg:col-span-2 space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <UserCircle2 className="w-5 h-5" /> 
                            Vé của bạn ({me?.name})
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
                            className="w-full mt-4 bg-yellow-400 hover:bg-yellow-500 text-red-800 font-black text-xl py-4 rounded-xl shadow-lg border-b-4 border-yellow-600 active:border-b-0 active:translate-y-1 transition-all uppercase tracking-widest"
                        >
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
                                <div key={p.id} className={`flex items-center justify-between p-2 rounded-lg text-sm ${p.id === playerId ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
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