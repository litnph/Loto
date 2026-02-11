import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw, AlertTriangle, VolumeX } from 'lucide-react';
import mqtt from 'mqtt';

// Sử dụng Public Broker có hỗ trợ WebSockets Secure (WSS)
const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; 
// Topic prefix để tránh trùng lặp trên public broker
const TOPIC_PREFIX = 'loto-vui-v3';

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
  const [isMuted, setIsMuted] = useState(false); // State for audio toggle
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const callIntervalRef = useRef<any>(null);
  const gameStateRef = useRef(gameState);

  // Sync state ref for event handlers
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
          clientRef.current.end();
      }
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
      window.speechSynthesis.cancel(); // Cancel speech on unmount
    };
  }, []);

  // --- Audio / TTS Helper ---
  const speakText = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;

    // Cancel previous utterance to avoid queue buildup
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN'; // Vietnamese voice
    utterance.rate = 1.0; 
    utterance.pitch = 1.1;
    
    // Fallback logic to ensure voice works reasonably well
    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find(v => v.lang.includes('vi'));
    if (viVoice) utterance.voice = viVoice;

    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  // --- MQTT Helpers ---
  
  const getHostTopic = (code: string) => `${TOPIC_PREFIX}/${code}/host`;
  const getClientTopic = (code: string) => `${TOPIC_PREFIX}/${code}/client`;

  const setupMqttClient = useCallback((clientId: string, onConnect: () => void) => {
    try {
        const client = mqtt.connect(BROKER_URL, {
            clientId,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30 * 1000,
        });

        client.on('connect', () => {
            console.log('MQTT Connected');
            setIsConnecting(false);
            onConnect();
        });

        client.on('error', (err) => {
            console.error('MQTT Error:', err);
            setIsConnecting(false);
            setConnectionError('Lỗi kết nối máy chủ tin nhắn. Vui lòng thử lại.');
        });

        client.on('offline', () => {
            console.log('MQTT Offline');
        });

        return client;
    } catch (err) {
        console.error("MQTT Setup Error", err);
        setConnectionError("Không thể khởi tạo kết nối mạng.");
        return null;
    }
  }, []);

  // --- Game Actions ---

  const createRoom = async (playerName: string) => {
    setIsConnecting(true);
    setConnectionError('');
    
    if (clientRef.current) clientRef.current.end();

    const shortCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const myId = `host-${Date.now()}`;
    setPlayerId(myId);

    const client = setupMqttClient(myId, () => {
        const myTicket = generateTicket();
        const hostPlayer: Player = {
            id: myId,
            name: playerName,
            isHost: true,
            isBot: false,
            ticket: myTicket,
            markedNumbers: new Set(),
        };

        const initialState: RoomState = {
            code: shortCode,
            players: [hostPlayer],
            status: 'waiting',
            calledNumbers: [],
            currentNumber: null,
            winner: null,
            mcCommentary: 'Chào mừng! Chia sẻ mã phòng cho bạn bè để bắt đầu.',
        };

        setGameState(initialState);

        // Host subscribes to client actions
        client.subscribe(getClientTopic(shortCode), (err) => {
            if (!err) {
                 // Publish initial state (retain=true so new joiners get it immediately)
                 publishState(client, shortCode, initialState);
            }
        });
    });

    if (client) {
        client.on('message', (topic, message) => {
            handleHostMessage(topic, message);
        });
        clientRef.current = client;
    }
  };

  const joinRoom = (playerName: string, roomCode: string) => {
    setIsConnecting(true);
    setConnectionError('');

    if (clientRef.current) clientRef.current.end();

    const myId = `player-${Date.now()}`;
    setPlayerId(myId);

    // Timeout check if room doesn't exist (no retained message received)
    const joinTimeout = setTimeout(() => {
        if (isConnecting) {
            setConnectionError("Không tìm thấy phòng hoặc mạng chậm. Hãy kiểm tra lại mã phòng.");
            setIsConnecting(false);
            if (clientRef.current) clientRef.current.end();
        }
    }, 10000);

    const client = setupMqttClient(myId, () => {
        // Guest subscribes to host state
        client.subscribe(getHostTopic(roomCode), (err) => {
            if (!err) {
                 // Send Join Request
                 const myTicket = generateTicket();
                 const joinPayload = {
                     type: 'JOIN_REQUEST',
                     player: {
                         id: myId,
                         name: playerName,
                         isHost: false,
                         isBot: false,
                         ticket: myTicket,
                         markedNumbers: [],
                     }
                 };
                 client.publish(getClientTopic(roomCode), JSON.stringify(joinPayload));
            }
        });
    });

    if (client) {
        client.on('message', (topic, message) => {
            // First message received means connection successful and room exists
            clearTimeout(joinTimeout);
            handleGuestMessage(topic, message);
        });
        clientRef.current = client;
    }
  };

  // --- Messaging Logic ---

  const publishState = (client: mqtt.MqttClient, code: string, state: RoomState) => {
      const payload = JSON.stringify({
          ...state,
          players: state.players.map(p => ({
              ...p,
              markedNumbers: Array.from(p.markedNumbers)
          }))
      });
      // Retain = true is CRITICAL for guests joining late or reconnecting
      client.publish(getHostTopic(code), payload, { retain: true });
  };

  const handleHostMessage = (topic: string, message: any) => {
      try {
          const data = JSON.parse(message.toString());
          const currentState = gameStateRef.current;
          let newState = { ...currentState };
          let shouldUpdate = false;

          if (data.type === 'JOIN_REQUEST') {
              if (!currentState.players.some(p => p.id === data.player.id)) {
                  const newPlayer: Player = {
                      ...data.player,
                      markedNumbers: new Set(data.player.markedNumbers)
                  };
                  newState.players = [...currentState.players, newPlayer];
                  shouldUpdate = true;
              }
          } 
          else if (data.type === 'MARK_UPDATE') {
              newState.players = currentState.players.map(p => {
                  if (p.id === data.playerId) {
                      return { ...p, markedNumbers: new Set<number>(data.markedNumbers) };
                  }
                  return p;
              });
              shouldUpdate = true;
          }
          else if (data.type === 'BINGO_CLAIM') {
              const player = currentState.players.find(p => p.id === data.playerId);
              if (player) {
                  const claimedMarked = new Set<number>(data.markedNumbers);
                  if (checkWin(player.ticket, claimedMarked)) {
                      newState.status = 'ended';
                      newState.winner = player;
                      newState.mcCommentary = `CHÚC MỪNG! ${player.name} ĐÃ KINH RỒI!`;
                      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
                      shouldUpdate = true;
                  }
              }
          }

          if (shouldUpdate) {
              setGameState(newState);
              if (clientRef.current) {
                  publishState(clientRef.current, currentState.code, newState);
              }
          }

      } catch (e) {
          console.error("Error parsing host message", e);
      }
  };

  const handleGuestMessage = (topic: string, message: any) => {
      try {
          // Message from Host is the full state
          const remoteState = JSON.parse(message.toString());
          
          // Hydrate Sets
          const hydratedPlayers = remoteState.players.map((p: any) => ({
              ...p,
              markedNumbers: new Set<number>(p.markedNumbers)
          }));

          setGameState({
              ...remoteState,
              players: hydratedPlayers,
          });
          
          // Valid state received
          setIsConnecting(false);

      } catch (e) {
          console.error("Error parsing guest message", e);
      }
  };

  // --- Game Loop (Host Only) ---

  const startGame = useCallback(() => {
    setGameState(prev => {
        const newState: RoomState = {
            ...prev,
            status: 'playing',
            mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
        };
        speakText("Trò chơi bắt đầu!");
        if (clientRef.current) publishState(clientRef.current, prev.code, newState);
        return newState;
    });
  }, [speakText]);

  const drawNumber = useCallback(async () => {
    const currentState = gameStateRef.current;
    if (currentState.status !== 'playing' || currentState.calledNumbers.length >= TOTAL_NUMBERS) return;
    
    const available = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1)
      .filter(n => !currentState.calledNumbers.includes(n));
    
    if (available.length === 0) return;
    
    const nextNum = available[Math.floor(Math.random() * available.length)];
    
    const newState = {
        ...currentState,
        currentNumber: nextNum,
        calledNumbers: [...currentState.calledNumbers, nextNum],
    };

    setGameState(newState);
    if (clientRef.current) publishState(clientRef.current, newState.code, newState);
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

  // MC Commentary Effect & TTS
  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    
    // Only fetch commentary if Host
    if (me?.isHost && gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        
        const currentState = gameStateRef.current;
        if(currentState.currentNumber !== gameState.currentNumber) return; // Stale

        const newState = { ...currentState, mcCommentary: text };
        setGameState(newState);
        if (clientRef.current) publishState(clientRef.current, newState.code, newState);
        
        setMcLoading(false);
      };
      fetchCommentary();
    }
  }, [gameState.currentNumber, gameState.status, playerId]);

  // TTS Effect - Triggers whenever commentary updates and we have a current number
  useEffect(() => {
    if (gameState.status === 'playing' && gameState.mcCommentary) {
        speakText(gameState.mcCommentary);
    } else if (gameState.status === 'ended' && gameState.winner) {
        speakText(gameState.mcCommentary); // Speak winner announcement
    }
  }, [gameState.mcCommentary, gameState.status, gameState.winner, speakText]);


  // --- User Interaction ---

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

    // Optimistic Update
    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked } : p
      );
      const newState = { ...prev, players: updatedPlayers };
      
      // If Host, broadcast immediately
      if (me.isHost && clientRef.current) {
          publishState(clientRef.current, prev.code, newState);
      }
      return newState;
    });

    // If Guest, send update to Host
    if (!me.isHost && clientRef.current) {
        clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
            type: 'MARK_UPDATE',
            playerId: playerId,
            markedNumbers: Array.from(newMarked)
        }));
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
                    if (clientRef.current) publishState(clientRef.current, prev.code, newState);
                    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
                    return newState;
            });
        } else {
            if (clientRef.current) {
                clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
                    type: 'BINGO_CLAIM',
                    playerId: playerId,
                    markedNumbers: Array.from(me.markedNumbers)
                }));
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
        if (clientRef.current) publishState(clientRef.current, prev.code, newState);
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
                <div style={{position: 'fixed', top: '20px', right: '20px', background: '#fee2e2', color: '#b91c1c', padding: '1rem', borderRadius: '8px', border: '1px solid #fca5a5', zIndex: 100, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}}>
                    <AlertTriangle size={20} />
                    <div>
                        <strong>Lỗi kết nối:</strong> <br/>
                        {connectionError}
                    </div>
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
          <div className="flex items-center gap-4">
              <button onClick={() => setIsMuted(!isMuted)} className="btn" style={{padding: '0.25rem', background: 'transparent', border: '1px solid #white', color: 'white'}}>
                 {isMuted ? <VolumeX size={20}/> : <Volume2 size={20}/>}
              </button>
              <div className="room-badge">
                {isConnecting ? <WifiOff size={16} /> : <Wifi size={16} style={{color: '#86efac'}}/>}
                Phòng: {gameState.code}
              </div>
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

        {/* Play Area - NEW LAYOUT */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div className="grid-layout">
            
            {/* LEFT COLUMN: Ticket & Bingo Button */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
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

            {/* RIGHT COLUMN: MC, Board, Players */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                {/* MC Section */}
                <div className="mc-section" style={{marginBottom: 0}}>
                    <div className="mc-title">
                        <Volume2 size={20} />
                        <span>MC Gemini</span>
                    </div>
                    
                    <div style={{minHeight: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                        {mcLoading ? (
                            <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                <Loader2 className="animate-spin" size={16} /> ...
                            </span>
                        ) : (
                            <p className="mc-text" style={{fontSize: '1.1rem'}}>"{gameState.mcCommentary}"</p>
                        )}
                    </div>

                    {gameState.currentNumber && (
                        <div className="current-number" style={{width: '5rem', height: '5rem', fontSize: '2.5rem', marginTop: '0.5rem'}}>
                            {gameState.currentNumber}
                        </div>
                    )}
                </div>

                {/* Number Board */}
                <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={gameState.currentNumber} />

                {/* Player List */}
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