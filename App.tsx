import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin, checkWaiting, formatCurrency } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS, TICKET_COLORS, TicketData } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw, AlertTriangle, VolumeX, CheckCircle2, Palette, Shuffle, X, Settings2, Flame, Coins, Plus, Eye, Trash2 } from 'lucide-react';
import mqtt from 'mqtt';

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; 
const TOPIC_PREFIX = 'loto-vui-v3';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<RoomState>({
    code: '',
    players: [],
    status: 'lobby',
    calledNumbers: [],
    currentNumber: null,
    winner: null,
    winningNumbers: [],
    mcCommentary: '',
    betPrice: 10000, // Default 10k
    pot: 0,
  });

  const [playerId, setPlayerId] = useState<string>('');
  const [mcLoading, setMcLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  
  // UI States
  const [activeSheetIndexForColor, setActiveSheetIndexForColor] = useState<number | null>(null);

  // Audio state
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const callIntervalRef = useRef<any>(null);
  const gameStateRef = useRef(gameState);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    return () => {
      if (clientRef.current) clientRef.current.end();
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
        if (!selectedVoiceURI) {
            const viVoice = vs.find(v => v.name === 'Google Tiếng Việt') || 
                            vs.find(v => v.name.includes('Vietnamese') || v.name.includes('Tiếng Việt')) ||
                            vs.find(v => v.lang.includes('vi'));
            if (viVoice) setSelectedVoiceURI(viVoice.voiceURI);
            else if (vs.length > 0) setSelectedVoiceURI(vs[0].voiceURI);
        }
      }
    };
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoiceURI]);

  const speakText = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN'; 
    const activeVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (activeVoice) utterance.voice = activeVoice;
    else {
        const viVoice = voices.find(v => v.lang.includes('vi'));
        if (viVoice) utterance.voice = viVoice;
    }
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
        const mySheet = generateTicket(TICKET_COLORS[0]);
        const hostPlayer: Player = {
            id: myId,
            name: playerName,
            isHost: true,
            isBot: false,
            sheets: [mySheet],
            markedNumbers: new Set(),
            isReady: true,
            color: TICKET_COLORS[0],
            isWaiting: false,
            balance: 0,
            sheetCount: 1,
            status: 'playing',
        };

        const initialState: RoomState = {
            code: shortCode,
            players: [hostPlayer],
            status: 'waiting',
            calledNumbers: [],
            currentNumber: null,
            winner: null,
            winningNumbers: [],
            mcCommentary: 'Chào mừng! Mọi người hãy chọn vé và bấm Sẵn Sàng nhé.',
            betPrice: 10000,
            pot: 0,
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
                 const randomColor = TICKET_COLORS[Math.floor(Math.random() * TICKET_COLORS.length)];
                 const mySheet = generateTicket(randomColor);
                 const joinPayload = {
                     type: 'JOIN_REQUEST',
                     player: {
                         id: myId,
                         name: playerName,
                         isHost: false,
                         isBot: false,
                         sheets: [mySheet],
                         markedNumbers: [],
                         isReady: false,
                         color: randomColor,
                         isWaiting: false,
                         balance: 0,
                         sheetCount: 1,
                         status: 'playing', // Will be corrected by host if game is running
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
    updatePlayerLocallyAndBroadcast(playerId, { isReady: newReadyStatus });
  };

  const updatePlayerLocallyAndBroadcast = (pId: string, changes: Partial<Player>) => {
      // Update Local
      setGameState(prev => {
          const updatedPlayers = prev.players.map(p => p.id === pId ? { ...p, ...changes } : p);
          const newState = { ...prev, players: updatedPlayers };
          // If I am host, broadcast state
          const me = prev.players.find(p => p.id === playerId);
          if (me?.isHost && clientRef.current) {
              publishState(clientRef.current, prev.code, newState);
          }
          return newState;
      });

      // If I am guest, send update request
      const me = gameState.players.find(p => p.id === playerId);
      if (!me?.isHost && clientRef.current) {
           clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
              type: 'PLAYER_UPDATE',
              playerId: pId,
              changes: changes
          }));
      }
  };

  const handleShuffleSheet = (index: number) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me || me.isReady) return;

      const newSheets = [...me.sheets];
      // Generate new ticket but keep the same color
      newSheets[index] = generateTicket(newSheets[index].color);
      
      updatePlayerLocallyAndBroadcast(playerId, { sheets: newSheets, markedNumbers: new Set() });
  };

  const handleSheetColorChange = (index: number, color: string) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me || me.isReady) return;

      const newSheets = [...me.sheets];
      newSheets[index] = { ...newSheets[index], color: color };
      
      // Also update player main color if it's the first sheet
      const extraChanges: Partial<Player> = { sheets: newSheets };
      if (index === 0) {
          extraChanges.color = color;
      }

      updatePlayerLocallyAndBroadcast(playerId, extraChanges);
      setActiveSheetIndexForColor(null);
  };

  const handleAddSheet = () => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me || me.isReady || me.sheets.length >= 6) return; // Limit 6

      // Inherit color from the last sheet or random
      const lastColor = me.sheets.length > 0 ? me.sheets[me.sheets.length - 1].color : TICKET_COLORS[0];
      const newSheet = generateTicket(lastColor);
      const newSheets = [...me.sheets, newSheet];
      
      updatePlayerLocallyAndBroadcast(playerId, { 
          sheets: newSheets, 
          sheetCount: newSheets.length,
          markedNumbers: new Set()
      });
  };

  const handleRemoveSheet = (index: number) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me || me.isReady || me.sheets.length <= 1) return;

      const newSheets = me.sheets.filter((_, i) => i !== index);
      
      updatePlayerLocallyAndBroadcast(playerId, { 
          sheets: newSheets, 
          sheetCount: newSheets.length,
          markedNumbers: new Set()
      });
  };

  const handleUpdateBetPrice = (newPrice: number) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me?.isHost || gameState.status !== 'waiting') return;

      setGameState(prev => {
          const newState = { ...prev, betPrice: newPrice };
          if(clientRef.current) publishState(clientRef.current, prev.code, newState);
          return newState;
      });
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
                  // If game is playing, set new player as spectator
                  const isLate = currentState.status === 'playing';
                  const newPlayer: Player = {
                      ...data.player,
                      markedNumbers: new Set(data.player.markedNumbers),
                      status: isLate ? 'spectating' : 'playing',
                      isReady: false,
                  };
                  newState.players = [...currentState.players, newPlayer];
                  shouldUpdate = true;
              }
          } 
          else if (data.type === 'MARK_UPDATE') {
              newState.players = currentState.players.map(p => {
                  if (p.id === data.playerId) {
                      return { 
                          ...p, 
                          markedNumbers: new Set<number>(data.markedNumbers),
                          isWaiting: data.isWaiting 
                      };
                  }
                  return p;
              });
              shouldUpdate = true;
          }
          else if (data.type === 'PLAYER_UPDATE') {
              newState.players = currentState.players.map(p => {
                  if (p.id === data.playerId) {
                      // Prevent changing sheet count if already ready (double check)
                      if (data.changes.sheetCount && p.isReady) return p;
                      return { ...p, ...data.changes };
                  }
                  return p;
              });
              shouldUpdate = true;
          }
          else if (data.type === 'BINGO_CLAIM') {
              const player = currentState.players.find(p => p.id === data.playerId);
              if (player && currentState.status === 'playing') {
                  const claimedMarked = new Set<number>(data.markedNumbers);
                  const winningRow = checkWin(player.sheets, claimedMarked);
                  if (winningRow) {
                      newState.status = 'ended';
                      newState.winner = player;
                      newState.winningNumbers = winningRow;
                      newState.mcCommentary = `CHÚC MỪNG! ${player.name} ĐÃ KINH RỒI!`;
                      
                      // Award Pot
                      newState.players = newState.players.map(p => 
                          p.id === player.id ? { ...p, balance: p.balance + newState.pot } : p
                      );
                      newState.pot = 0; // Reset pot display (or keep it to show what was won)

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
          const hydratedPlayers: Player[] = remoteState.players.map((p: any) => ({
              ...p,
              markedNumbers: new Set<number>(p.markedNumbers as number[])
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
    const playingPlayers = gameStateRef.current.players.filter(p => p.status === 'playing');
    const allReady = playingPlayers.length > 0 && playingPlayers.every(p => p.isReady);
    
    if (!allReady) {
        alert("Vẫn còn người chơi chưa sẵn sàng!");
        return;
    }

    setGameState(prev => {
        // Calculate Pot and deduct balances
        let roundPot = 0;
        const updatedPlayers = prev.players.map(p => {
            if (p.status === 'playing') {
                const cost = p.sheetCount * prev.betPrice;
                roundPot += cost;
                return { ...p, balance: p.balance - cost };
            }
            return p;
        });

        const newState: RoomState = {
            ...prev,
            players: updatedPlayers,
            status: 'playing',
            mcCommentary: 'Trò chơi bắt đầu! Chuẩn bị dò số nào...',
            pot: roundPot
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
    if (!me || me.status === 'spectating') return;

    const newMarked = new Set<number>(me.markedNumbers);
    if (newMarked.has(num)) newMarked.delete(num);
    else newMarked.add(num);

    const isWaiting = checkWaiting(me.sheets, newMarked);

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, markedNumbers: newMarked, isWaiting: isWaiting } : p
      );
      const newState = { ...prev, players: updatedPlayers };
      if (me.isHost && clientRef.current) publishState(clientRef.current, prev.code, newState);
      return newState;
    });

    if (!me.isHost && clientRef.current) {
        clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
            type: 'MARK_UPDATE',
            playerId: playerId,
            markedNumbers: Array.from(newMarked),
            isWaiting: isWaiting
        }));
    }
  };

  const handleKinhCall = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me || me.status === 'spectating') return;

    const winningRow = checkWin(me.sheets, me.markedNumbers);

    if (winningRow) {
        if (me.isHost) {
             setGameState(prev => {
                    const newState = {
                        ...prev,
                        status: 'ended' as GameStatus,
                        winner: me,
                        winningNumbers: winningRow,
                        mcCommentary: `CHÚC MỪNG! ${me.name} ĐÃ KINH RỒI!`,
                        pot: 0,
                        players: prev.players.map(p => 
                          p.id === me.id ? { ...p, balance: p.balance + prev.pot } : p
                        )
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
            winningNumbers: [],
            mcCommentary: 'Bắt đầu ván mới nào!',
            pot: 0, // Reset pot
            players: prev.players.map(p => ({
                ...p,
                markedNumbers: new Set(),
                isReady: p.id === playerId,
                isWaiting: false,
                status: 'playing', // Everyone back to playing status
            }))
        };
        if (clientRef.current) publishState(clientRef.current, prev.code, newState);
        return newState;
    });
  };

  // --- Render ---
  const me = gameState.players.find(p => p.id === playerId);
  const isHost = me?.isHost;
  const isSpectator = me?.status === 'spectating';
  const allPlayersReady = gameState.players.filter(p => p.status === 'playing').length > 0 && 
                          gameState.players.filter(p => p.status === 'playing').every(p => p.isReady);

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
              {/* My Balance Display */}
              {me && (
                  <div style={{background: 'rgba(255,255,255,0.2)', padding: '0.25rem 0.75rem', borderRadius: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'bold'}}>
                      <Coins size={16} className="text-secondary" />
                      {formatCurrency(me.balance)}
                  </div>
              )}
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
            <div className="card text-center" style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                <h2 style={{fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem'}}>Phòng Chờ</h2>
                <div style={{background: '#f3f4f6', padding: '0.5rem 1.5rem', borderRadius: '8px', display: 'inline-block', marginBottom: '1rem'}}>
                    <p style={{color: '#6b7280', fontSize: '0.875rem'}}>Mã Phòng</p>
                    <p style={{fontSize: '2rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#dc2626', lineHeight: 1}}>{gameState.code}</p>
                </div>
                
                {/* Bet Price Setting */}
                <div style={{display: 'flex', alignItems: 'center', gap: '1rem', background: '#fff7ed', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #fed7aa'}}>
                    <Coins size={20} className="text-secondary" />
                    <span style={{fontWeight: 'bold', color: '#9a3412'}}>Tiền cược/Lá:</span>
                    {isHost ? (
                        <input 
                            type="number" 
                            step="1000"
                            value={gameState.betPrice}
                            onChange={(e) => handleUpdateBetPrice(Number(e.target.value))}
                            style={{padding: '0.25rem', borderRadius: '0.25rem', border: '1px solid #d1d5db', width: '100px', fontWeight: 'bold'}}
                        />
                    ) : (
                        <span style={{fontWeight: 'bold', fontSize: '1.1rem'}}>{formatCurrency(gameState.betPrice)}</span>
                    )}
                </div>
            </div>

            <div className="grid-layout">
                {/* Left: My Setup */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    {me && (
                        <>
                        <div className="card" style={{padding: '1rem', borderTop: `4px solid ${me.color}`}}>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="font-bold">Bộ Vé Của Bạn ({me.sheets.length} Lá)</h3>
                            </div>
                            
                            <div className="ticket-grid">
                                {me.sheets.map((sheet, idx) => (
                                    <div key={sheet.id} style={{position: 'relative'}}>
                                         <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem'}}>
                                            <span className="text-xs font-bold text-muted">Lá {idx + 1}</span>
                                            {!me.isReady && (
                                                <div className="flex gap-1">
                                                    <button onClick={() => handleShuffleSheet(idx)} className="btn-icon" title="Đổi số">
                                                        <Shuffle size={14} />
                                                    </button>
                                                    <button onClick={() => setActiveSheetIndexForColor(idx)} className="btn-icon" title="Đổi màu" style={{color: sheet.color}}>
                                                        <Palette size={14} />
                                                    </button>
                                                    <button onClick={() => handleRemoveSheet(idx)} className="btn-icon" title="Xóa lá" style={{color: '#ef4444'}}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            )}
                                         </div>
                                         <div style={{transform: 'scale(0.95)', transformOrigin: 'top left'}}>
                                            <Ticket ticket={sheet} markedNumbers={me.markedNumbers} disabled={true} color={sheet.color} />
                                         </div>
                                    </div>
                                ))}
                            </div>

                            {!me.isReady && (
                                <button 
                                    onClick={handleAddSheet} 
                                    className="btn w-full mt-4" 
                                    style={{border: '2px dashed #d1d5db', background: 'transparent', color: '#6b7280'}}
                                >
                                    <Plus size={20} /> Thêm Lá Mới (Max 6)
                                </button>
                            )}
                            
                            <div className="mt-4 p-2 bg-red-50 rounded border border-red-100 text-center text-sm text-red-800">
                                Tổng cược: <b>{formatCurrency(me.sheetCount * gameState.betPrice)}</b>
                            </div>

                            <button 
                                onClick={handleToggleReady} 
                                className={`btn w-full ${!me.isReady ? 'btn-pulse' : ''}`} 
                                style={{
                                    marginTop: '1rem', 
                                    background: me.isReady ? '#16a34a' : '#2563eb', // Blue for Call to Action, Green for Done
                                    color: 'white',
                                    fontWeight: '800',
                                    boxShadow: !me.isReady ? '0 4px 12px rgba(37, 99, 235, 0.4)' : 'none'
                                }}
                            >
                                {me.isReady ? <><CheckCircle2 /> ĐÃ SẴN SÀNG</> : <><Play /> BẤM ĐỂ SẴN SÀNG</>}
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
                                        <div>
                                            <span style={{fontWeight: 'bold'}}>{p.name}</span>
                                            <div className="text-xs text-muted flex items-center gap-1">
                                                <Coins size={10} /> {formatCurrency(p.balance)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        {p.isReady ? (
                                            <span style={{color: '#16a34a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <CheckCircle2 size={16} /> Sẵn sàng
                                            </span>
                                        ) : (
                                            <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <Loader2 size={16} className="animate-spin" /> Đang chọn ({p.sheetCount} lá)
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
                                {!allPlayersReady ? 'CHỜ MỌI NGƯỜI SẴN SÀNG...' : <><Play size={24}/> BẮT ĐẦU VÁN ({formatCurrency(gameState.players.filter(p => p.status === 'playing').reduce((sum, p) => sum + (p.sheetCount * gameState.betPrice), 0))})</>}
                            </button>
                        </div>
                     ) : (
                        <div className="text-center text-muted">
                            {me?.isReady ? 'Đang chờ chủ phòng bắt đầu...' : 'Hãy chọn vé và bấm Sẵn sàng!'}
                        </div>
                     )}
                </div>
            </div>
            
            {activeSheetIndexForColor !== null && (
                <div className="overlay">
                    <div className="modal" style={{maxWidth: '20rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <h3 className="font-bold" style={{margin: 0, fontSize: '1.25rem'}}>Chọn Màu Cho Lá {activeSheetIndexForColor + 1}</h3>
                            <button className="btn-close" onClick={() => setActiveSheetIndexForColor(null)}><X size={20} /></button>
                        </div>
                        <div className="color-grid">
                            {TICKET_COLORS.map(color => (
                                <div key={color} className={`color-swatch`} style={{backgroundColor: color}} onClick={() => handleSheetColorChange(activeSheetIndexForColor, color)} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
          </div>
        )}

        {/* Play Area */}
        {(gameState.status === 'playing' || gameState.status === 'ended') && (
          <div className="grid-layout">
            {/* LEFT COLUMN: TICKETS */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
                        <UserCircle2 size={24} style={{color: me?.color || '#dc2626'}} /> 
                        <h3 className="font-bold" style={{fontSize: '1.25rem'}}>Vé Của Bạn ({me?.name})</h3>
                    </div>
                    
                    {me && isSpectator ? (
                        <div className="card text-center p-8 bg-gray-100 border-dashed border-2 border-gray-300">
                             <Eye size={48} className="mx-auto text-gray-400 mb-2" />
                             <h3 className="text-lg font-bold text-gray-600">Chế độ Khán Giả</h3>
                             <p className="text-gray-500">Bạn vào sau khi ván đã bắt đầu. Vui lòng đợi ván sau nhé!</p>
                        </div>
                    ) : (
                        <div className="ticket-grid">
                            {me && me.sheets.map((sheet, idx) => (
                                <div key={sheet.id} style={{marginBottom: '1rem'}}>
                                    <div className="text-xs font-bold text-muted mb-1 ml-1">Lá {idx + 1}</div>
                                    <Ticket 
                                        ticket={sheet} 
                                        markedNumbers={me.markedNumbers} 
                                        onNumberClick={handleMarkNumber}
                                        disabled={gameState.status === 'ended' || isSpectator}
                                        color={sheet.color}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {gameState.status === 'playing' && !isSpectator && (
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

            {/* RIGHT COLUMN: INFO & BOARD */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                
                {/* Pot Display */}
                <div className="card bg-yellow-50 border-yellow-200 text-center p-4">
                    <div className="text-xs text-yellow-800 uppercase font-bold tracking-wider">Tổng Giải Thưởng (Hũ)</div>
                    <div className="text-3xl font-extrabold text-yellow-600 flex items-center justify-center gap-2">
                        <Coins size={32} />
                        {formatCurrency(gameState.pot)}
                    </div>
                </div>

                {/* MC Section */}
                <div className="mc-section" style={{marginBottom: 0}}>
                    <div className="mc-title">
                        <div className="flex flex-col items-center">
                            <div className="flex items-center gap-2">
                                <Volume2 size={20} />
                                <span>MC Gemini</span>
                            </div>
                            <div className="flex items-center gap-1 mt-1" style={{fontSize: '0.75rem'}}>
                                <Settings2 size={12} className="text-muted" />
                                <select 
                                    value={selectedVoiceURI} 
                                    onChange={(e) => setSelectedVoiceURI(e.target.value)}
                                    style={{border: 'none', background: 'transparent', color: '#6b7280', maxWidth: '150px', fontSize: '0.75rem', cursor: 'pointer', outline: 'none'}}
                                >
                                    {voices.length === 0 && <option value="">Đang tải giọng...</option>}
                                    {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
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

                {/* Player List */}
                <div className="card" style={{padding: '1rem'}}>
                    <h3 className="font-bold" style={{marginBottom: '0.75rem', display: 'flex', alignItems: 'center'}}>
                        <Users size={20} style={{marginRight: '0.5rem', color: '#3b82f6'}} />
                        Bảng Xếp Hạng
                    </h3>
                    <div className="player-list custom-scrollbar">
                        {gameState.players.sort((a,b) => b.balance - a.balance).map(p => {
                                const markedCount = p.markedNumbers.size;
                                return (
                                <div key={p.id} className={`player-item ${p.id === playerId ? 'is-me' : ''}`} style={{opacity: p.status === 'spectating' ? 0.6 : 1}}>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                                        <div className="avatar" style={{background: p.color}}>{p.name.charAt(0).toUpperCase()}</div>
                                        <div style={{display: 'flex', flexDirection: 'column'}}>
                                            <span style={{fontWeight: 'bold', color: p.id === playerId ? 'black' : '#4b5563'}}>
                                                {p.name}
                                            </span>
                                            <span style={{fontSize: '0.7rem', color: p.balance >= 0 ? 'green' : 'red', fontWeight: 'bold'}}>
                                                {formatCurrency(p.balance)}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                        {p.status === 'spectating' ? (
                                             <div className="text-xs bg-gray-200 px-2 py-1 rounded">Xem</div>
                                        ) : (
                                            <>
                                            {p.isWaiting && <div className="badge-waiting"><Flame size={12} fill="#d97706" /> CHỜ</div>}
                                            <div style={{fontSize: '0.75rem', padding: '2px 6px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '4px'}}>
                                                {markedCount} số
                                            </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                )
                        })}
                    </div>
                </div>

                <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={gameState.currentNumber} />

            </div>
            
            {gameState.status === 'ended' && gameState.winner && (
              <div className="overlay">
                <div className="modal animate-in fade-in zoom-in">
                  <div className="modal-icon animate-bounce">
                    <Trophy size={48} style={{color: '#ca8a04'}} />
                  </div>
                  <h2 style={{fontSize: '2.25rem', fontWeight: '800', color: '#dc2626', marginBottom: '0.5rem', textTransform: 'uppercase'}}>Chiến Thắng!</h2>
                  <p style={{color: '#4b5563', fontSize: '1.125rem', marginBottom: '0.5rem'}}>
                    Chúc mừng <span style={{fontWeight: 'bold', color: 'black'}}>{gameState.winner.name}</span> đã Kinh!
                  </p>
                  <p style={{fontSize: '1.25rem', color: '#16a34a', fontWeight: 'bold', marginBottom: '1.5rem'}}>
                      + {formatCurrency(gameState.players.find(p => p.id === gameState.winner?.id)?.balance || 0)}
                  </p>
                  
                  <div style={{marginBottom: '2rem'}}>
                      <p style={{fontSize: '0.875rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Hàng Số Chiến Thắng</p>
                      <div className="win-numbers-grid">
                          {gameState.winningNumbers.sort((a,b) => a-b).map(num => (
                              <div key={num} className="win-number-ball">{num}</div>
                          ))}
                      </div>
                  </div>

                  <div style={{marginBottom: '1.5rem', borderTop: '2px dashed #e5e7eb', paddingTop: '1.5rem'}}>
                       <p style={{fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem'}}>Bảng Số Đã Gọi</p>
                       <div style={{transform: 'scale(0.9)', transformOrigin: 'top center'}}>
                         <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={null} />
                       </div>
                  </div>
                  
                  {isHost ? (
                      <button onClick={resetGame} className="btn btn-primary w-full" style={{padding: '1rem', fontSize: '1.1rem'}}>
                        <RefreshCw size={20} /> Chơi Ván Mới
                      </button>
                  ) : (
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#6b7280'}}>
                          <Loader2 className="animate-spin" size={16} /> <span>Chờ chủ phòng bắt đầu lại...</span>
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