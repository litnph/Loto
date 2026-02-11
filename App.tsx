import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS, TICKET_COLORS } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw, AlertTriangle, VolumeX, CheckCircle2, XCircle, Palette, Shuffle, X, Settings2 } from 'lucide-react';
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
  const [isMuted, setIsMuted] = useState(false);
  
  // UI States
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Audio state
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const callIntervalRef = useRef<any>(null);
  const gameStateRef = useRef(gameState);

  // Sync state ref for event handlers
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
          clientRef.current.end();
      }
      if (callIntervalRef.current) clearInterval(callIntervalRef.current);
      window.speechSynthesis.cancel();
    };
  }, []);

  // --- Audio / TTS Setup ---
  useEffect(() => {
    const loadVoices = () => {
      const vs = window.speechSynthesis.getVoices();
      if (vs.length > 0) {
        setVoices(vs);
        
        // Auto-select best Vietnamese voice if not yet selected
        if (!selectedVoiceURI) {
            const viVoice = vs.find(v => v.name === 'Google Tiếng Việt') || 
                            vs.find(v => v.name.includes('Vietnamese') || v.name.includes('Tiếng Việt')) ||
                            vs.find(v => v.lang.includes('vi'));
            if (viVoice) {
                setSelectedVoiceURI(viVoice.voiceURI);
            } else if (vs.length > 0) {
                // Fallback to first voice if no Vietnamese found (user can change later)
                setSelectedVoiceURI(vs[0].voiceURI);
            }
        }
      }
    };

    // Chrome loads voices asynchronously
    window.speechSynthesis.onvoiceschanged = loadVoices;
    // Initial attempt
    loadVoices();

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoiceURI]); // Depend on selectedVoiceURI to avoid overwriting user choice

  const speakText = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;
    
    // Cancel any ongoing speech to prevent queue buildup
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Force Lang Code
    utterance.lang = 'vi-VN'; 
    
    // Find the selected voice object
    const activeVoice = voices.find(v => v.voiceURI === selectedVoiceURI);

    if (activeVoice) {
        utterance.voice = activeVoice;
        console.log("Speaking with:", activeVoice.name);
    } else {
        // Fallback logic if selection is invalid for some reason
        const viVoice = voices.find(v => v.lang.includes('vi'));
        if (viVoice) utterance.voice = viVoice;
    }
    
    // Adjust rate: slightly slower for Bingo to be clear
    utterance.rate = 0.85; 
    utterance.pitch = 1.0;

    window.speechSynthesis.speak(utterance);
  }, [isMuted, voices, selectedVoiceURI]);

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
            isReady: true, // Host automatically ready
            color: TICKET_COLORS[0],
        };

        const initialState: RoomState = {
            code: shortCode,
            players: [hostPlayer],
            status: 'waiting',
            calledNumbers: [],
            currentNumber: null,
            winner: null,
            mcCommentary: 'Chào mừng! Mọi người hãy chọn vé và bấm Sẵn Sàng nhé.',
        };

        setGameState(initialState);

        client.subscribe(getClientTopic(shortCode), (err) => {
            if (!err) publishState(client, shortCode, initialState);
        });
    });

    if (client) {
        client.on('message', (topic, message) => handleHostMessage(topic, message));
        clientRef.current = client;
    }
  };

  const joinRoom = (playerName: string, roomCode: string) => {
    setIsConnecting(true);
    setConnectionError('');
    if (clientRef.current) clientRef.current.end();

    const myId = `player-${Date.now()}`;
    setPlayerId(myId);

    const joinTimeout = setTimeout(() => {
        if (isConnecting) {
            setConnectionError("Không tìm thấy phòng hoặc mạng chậm. Hãy kiểm tra lại mã phòng.");
            setIsConnecting(false);
            if (clientRef.current) clientRef.current.end();
        }
    }, 10000);

    const client = setupMqttClient(myId, () => {
        client.subscribe(getHostTopic(roomCode), (err) => {
            if (!err) {
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
                         isReady: false,
                         color: TICKET_COLORS[Math.floor(Math.random() * TICKET_COLORS.length)],
                     }
                 };
                 client.publish(getClientTopic(roomCode), JSON.stringify(joinPayload));
            }
        });
    });

    if (client) {
        client.on('message', (topic, message) => {
            clearTimeout(joinTimeout);
            handleGuestMessage(topic, message);
        });
        clientRef.current = client;
    }
  };

  // --- Logic for Ready / Customize ---

  const handleToggleReady = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;

    const newReadyStatus = !me.isReady;
    
    // Update Local Optimistically
    setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => p.id === playerId ? { ...p, isReady: newReadyStatus } : p)
    }));

    if (me.isHost) {
        // If host, update and publish immediately
        if (clientRef.current) {
            const currentState = gameStateRef.current;
            const newState = {
                ...currentState,
                players: currentState.players.map(p => p.id === playerId ? { ...p, isReady: newReadyStatus } : p)
            };
            publishState(clientRef.current, currentState.code, newState);
        }
    } else {
        // If guest, send update to host
        if (clientRef.current) {
            clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
                type: 'PLAYER_UPDATE',
                playerId: playerId,
                changes: { isReady: newReadyStatus }
            }));
        }
    }
  };

  const handleChangeTicket = () => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me || me.isReady) return; // Cannot change if ready

      const newTicket = generateTicket();
      
      // Update Local
      setGameState(prev => ({
          ...prev,
          players: prev.players.map(p => p.id === playerId ? { ...p, ticket: newTicket } : p)
      }));

      // Broadcast
      if (me.isHost && clientRef.current) {
          const currentState = gameStateRef.current;
          const newState = {
              ...currentState,
              players: currentState.players.map(p => p.id === playerId ? { ...p, ticket: newTicket } : p)
          };
          publishState(clientRef.current, currentState.code, newState);
      } else if (clientRef.current) {
          clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
              type: 'PLAYER_UPDATE',
              playerId: playerId,
              changes: { ticket: newTicket }
          }));
      }
  };

  const handleSelectColor = (selectedColor: string) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me) return;

      // Update Local
      setGameState(prev => ({
          ...prev,
          players: prev.players.map(p => p.id === playerId ? { ...p, color: selectedColor } : p)
      }));
      
      setShowColorPicker(false);

      // Broadcast
      if (me.isHost && clientRef.current) {
          const currentState = gameStateRef.current;
          const newState = {
              ...currentState,
              players: currentState.players.map(p => p.id === playerId ? { ...p, color: selectedColor } : p)
          };
          publishState(clientRef.current, currentState.code, newState);
      } else if (clientRef.current) {
          clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
              type: 'PLAYER_UPDATE',
              playerId: playerId,
              changes: { color: selectedColor }
          }));
      }
  };

  // --- MQTT Messaging Logic ---

  const publishState = (client: mqtt.MqttClient, code: string, state: RoomState) => {
      const payload = JSON.stringify({
          ...state,
          players: state.players.map(p => ({
              ...p,
              markedNumbers: Array.from(p.markedNumbers)
          }))
      });
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
          else if (data.type === 'PLAYER_UPDATE') {
              // Handle generic updates (Ready status, Ticket change, Color change)
              newState.players = currentState.players.map(p => {
                  if (p.id === data.playerId) {
                      return { ...p, ...data.changes };
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
          const remoteState = JSON.parse(message.toString());
          const hydratedPlayers = remoteState.players.map((p: any) => ({
              ...p,
              markedNumbers: new Set<number>(p.markedNumbers)
          }));

          setGameState({
              ...remoteState,
              players: hydratedPlayers,
          });
          setIsConnecting(false);
      } catch (e) {
          console.error("Error parsing guest message", e);
      }
  };

  // --- Game Loop (Host Only) ---

  const startGame = useCallback(() => {
    // Check if everyone is ready
    const allReady = gameStateRef.current.players.every(p => p.isReady);
    if (!allReady) {
        alert("Vẫn còn người chơi chưa sẵn sàng!");
        return;
    }

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

  useEffect(() => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me?.isHost && gameState.currentNumber && gameState.status === 'playing') {
      const fetchCommentary = async () => {
        setMcLoading(true);
        const text = await generateMCCommentary(gameState.currentNumber!);
        const currentState = gameStateRef.current;
        if(currentState.currentNumber !== gameState.currentNumber) return;
        const newState = { ...currentState, mcCommentary: text };
        setGameState(newState);
        if (clientRef.current) publishState(clientRef.current, newState.code, newState);
        setMcLoading(false);
      };
      fetchCommentary();
    }
  }, [gameState.currentNumber, gameState.status, playerId]);

  useEffect(() => {
    if (gameState.status === 'playing' && gameState.mcCommentary) {
        speakText(gameState.mcCommentary);
    } else if (gameState.status === 'ended' && gameState.winner) {
        speakText(gameState.mcCommentary);
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

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked } : p
      );
      const newState = { ...prev, players: updatedPlayers };
      if (me.isHost && clientRef.current) publishState(clientRef.current, prev.code, newState);
      return newState;
    });

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
                markedNumbers: new Set(),
                isReady: p.id === playerId // Host automatically ready, others reset
            }))
        };
        if (clientRef.current) publishState(clientRef.current, prev.code, newState);
        return newState;
    });
  };

  // --- Render ---
  const me = gameState.players.find(p => p.id === playerId);
  const isHost = me?.isHost;
  const allPlayersReady = gameState.players.length > 1 && gameState.players.every(p => p.isReady);

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
          <div style={{display: 'flex', flexDirection: 'column', gap: '2rem'}}>
            <div className="card text-center">
                <h2 style={{fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem'}}>Phòng Chờ</h2>
                <div style={{background: '#f3f4f6', padding: '1rem', borderRadius: '8px', display: 'inline-block'}}>
                    <p style={{color: '#6b7280', marginBottom: '0.25rem'}}>Mã Phòng:</p>
                    <p style={{fontSize: '2rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#dc2626'}}>{gameState.code}</p>
                </div>
            </div>

            <div className="grid-layout">
                {/* Left: My Setup */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    {me && (
                        <>
                        <div className="card" style={{padding: '1rem', borderTop: `4px solid ${me.color}`}}>
                            <h3 className="font-bold mb-2">Vé Của Bạn</h3>
                            <Ticket 
                                ticket={me.ticket} 
                                markedNumbers={me.markedNumbers} 
                                disabled={true}
                                color={me.color}
                            />
                            
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '1rem'}}>
                                <button 
                                    onClick={handleChangeTicket} 
                                    disabled={me.isReady}
                                    className="btn"
                                    style={{background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db'}}
                                >
                                    <Shuffle size={18} /> Đổi Số
                                </button>
                                <button 
                                    onClick={() => setShowColorPicker(true)}
                                    className="btn"
                                    style={{background: me.color, color: 'white'}}
                                >
                                    <Palette size={18} /> Đổi Màu
                                </button>
                            </div>
                            
                            <button 
                                onClick={handleToggleReady}
                                className={`btn w-full ${me.isReady ? 'btn-primary' : ''}`}
                                style={{marginTop: '1rem', background: me.isReady ? '#16a34a' : '#9ca3af', color: 'white'}}
                            >
                                {me.isReady ? <><CheckCircle2 /> ĐÃ SẴN SÀNG</> : 'BẤM ĐỂ SẴN SÀNG'}
                            </button>
                        </div>
                        </>
                    )}
                </div>

                {/* Right: Player Status & Start */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                     <div className="card" style={{padding: '1rem'}}>
                        <h3 className="font-bold mb-3 flex items-center">
                            <Users size={20} className="mr-2" /> 
                            Người Chơi ({gameState.players.length})
                        </h3>
                        <div className="player-list custom-scrollbar">
                            {gameState.players.map(p => (
                                <div key={p.id} className="player-item" style={{justifyContent: 'space-between'}}>
                                    <div className="flex items-center gap-2">
                                        <div className="avatar" style={{background: p.color}}>{p.name.charAt(0).toUpperCase()}</div>
                                        <span style={{fontWeight: 'bold'}}>{p.name} {p.isHost && '👑'}</span>
                                    </div>
                                    <div>
                                        {p.isReady ? (
                                            <span style={{color: '#16a34a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <CheckCircle2 size={16} /> Sẵn sàng
                                            </span>
                                        ) : (
                                            <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <Loader2 size={16} className="animate-spin" /> Đang chọn...
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                     </div>

                     {isHost ? (
                        <div style={{marginTop: 'auto'}}>
                            <button 
                                onClick={startGame}
                                disabled={!allPlayersReady}
                                className="btn btn-primary w-full"
                                style={{padding: '1rem', fontSize: '1.2rem', opacity: !allPlayersReady ? 0.5 : 1}}
                            >
                                {!allPlayersReady ? 'CHỜ MỌI NGƯỜI SẴN SÀNG...' : <><Play size={24}/> BẮT ĐẦU NGAY</>}
                            </button>
                        </div>
                     ) : (
                        <div className="text-center text-muted">
                            {me?.isReady ? 'Đang chờ chủ phòng bắt đầu...' : 'Hãy chọn vé và bấm Sẵn sàng!'}
                        </div>
                     )}
                </div>
            </div>
            
            {/* Color Picker Modal */}
            {showColorPicker && (
                <div className="overlay">
                    <div className="modal" style={{maxWidth: '20rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <h3 className="font-bold" style={{margin: 0, fontSize: '1.25rem'}}>Chọn Màu Vé</h3>
                            <button className="btn-close" onClick={() => setShowColorPicker(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="color-grid">
                            {TICKET_COLORS.map(color => (
                                <div
                                    key={color}
                                    className={`color-swatch ${me?.color === color ? 'active' : ''}`}
                                    style={{backgroundColor: color}}
                                    onClick={() => handleSelectColor(color)}
                                />
                            ))}
                        </div>
                        
                        <p className="text-center text-muted" style={{fontSize: '0.875rem'}}>
                            Chọn màu để dễ nhận biết vé của bạn.
                        </p>
                    </div>
                </div>
            )}
          </div>
        )}

        {/* Play Area */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div className="grid-layout">
            {/* LEFT COLUMN */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
                        <UserCircle2 size={24} style={{color: me?.color || '#dc2626'}} /> 
                        <h3 className="font-bold" style={{fontSize: '1.25rem'}}>Vé Của Bạn ({me?.name})</h3>
                    </div>
                    {me && (
                    <Ticket 
                        ticket={me.ticket} 
                        markedNumbers={me.markedNumbers} 
                        onNumberClick={handleMarkNumber}
                        disabled={gameState.status === 'ended'}
                        color={me.color}
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

            {/* RIGHT COLUMN */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                <div className="mc-section" style={{marginBottom: 0}}>
                    <div className="mc-title">
                        <div className="flex flex-col items-center">
                            <div className="flex items-center gap-2">
                                <Volume2 size={20} />
                                <span>MC Gemini</span>
                            </div>
                            
                            {/* Voice Selector Dropdown */}
                            <div className="flex items-center gap-1 mt-1" style={{fontSize: '0.75rem'}}>
                                <Settings2 size={12} className="text-muted" />
                                <select 
                                    value={selectedVoiceURI} 
                                    onChange={(e) => setSelectedVoiceURI(e.target.value)}
                                    style={{
                                        border: 'none', 
                                        background: 'transparent', 
                                        color: '#6b7280', 
                                        maxWidth: '150px',
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        outline: 'none'
                                    }}
                                >
                                    {voices.length === 0 && <option value="">Đang tải giọng...</option>}
                                    {voices.map(v => (
                                        <option key={v.voiceURI} value={v.voiceURI}>
                                            {v.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
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
                                        <div className="avatar" style={{background: p.color}}>
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