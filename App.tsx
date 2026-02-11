import React, { useState, useEffect, useCallback, useRef } from 'react';
import { generateTicket, checkWin, checkWaiting, formatCurrency } from './utils/gameUtils';
import { Player, RoomState, GameStatus, TOTAL_NUMBERS, CALL_INTERVAL_MS, TICKET_COLORS, TicketData, ChatMessage } from './types';
import Lobby from './components/Lobby';
import Ticket from './components/Ticket';
import NumberBoard from './components/NumberBoard';
import ChatBox from './components/ChatBox';
import { generateMCCommentary } from './services/geminiService';
import { Users, Trophy, Play, Volume2, UserCircle2, Loader2, Wifi, WifiOff, RefreshCw, AlertTriangle, VolumeX, CheckCircle2, Palette, Shuffle, X, Settings2, Flame, Coins, Plus, Eye, Trash2, Mic, LogOut, Pencil, Save } from 'lucide-react';
import mqtt from 'mqtt';

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; 
const TOPIC_PREFIX = 'loto-vui-v3';

const INITIAL_STATE: RoomState = {
    code: '',
    players: [],
    status: 'lobby',
    calledNumbers: [],
    currentNumber: null,
    winner: null,
    winningNumbers: [],
    mcCommentary: '',
    betPrice: 10000,
    pot: 0,
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<RoomState>(INITIAL_STATE);

  const [playerId, setPlayerId] = useState<string>('');
  const [mcLoading, setMcLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  
  // Chat States
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // UI States
  const [activeSheetIndexForColor, setActiveSheetIndexForColor] = useState<number | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Audio state
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const callIntervalRef = useRef<any>(null);
  const gameStateRef = useRef(gameState);
  
  // Refs for stable access inside callbacks to prevent stale closures/race conditions
  const playerIdRef = useRef(playerId);
  const isConnectingRef = useRef(isConnecting);
  
  // CRITICAL FIX: Local Source of Truth for marked numbers to prevent race conditions on fast clicks
  const localMarkedNumbersRef = useRef<Set<number>>(new Set());

  // Ref for chat open status to use inside callbacks
  const isChatOpenRef = useRef(isChatOpen);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);
  useEffect(() => { isConnectingRef.current = isConnecting; }, [isConnecting]);
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);

  // Reset unread count when chat opens
  useEffect(() => {
    if (isChatOpen) {
        setUnreadChatCount(0);
    }
  }, [isChatOpen]);

  // Reset local marks ref when starting new game or changing player
  useEffect(() => {
     if (gameState.status === 'waiting') {
         localMarkedNumbersRef.current.clear();
     }
  }, [gameState.status]);

  useEffect(() => {
     localMarkedNumbersRef.current.clear();
  }, [playerId]);

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
        
        // Debugging logs based on user request
        const vnVoices = vs.filter(v => v.lang === "vi-VN");
        console.log("Vietnamese voices:", vnVoices);

        if (!selectedVoiceURI) {
            // Priority: Google Tiếng Việt (Chrome) -> Microsoft HoaiMy (Edge) -> Generic vi-VN -> Any 'vi'
            const viVoice = vs.find(v => v.name === 'Google Tiếng Việt') || 
                            vs.find(v => v.name.includes('HoaiMy')) || 
                            vs.find(v => v.lang === 'vi-VN') || 
                            vs.find(v => v.lang.includes('vi'));
            
            if (viVoice) {
                console.log("Auto-selected voice:", viVoice.name);
                setSelectedVoiceURI(viVoice.voiceURI);
            } else if (vs.length > 0) {
                setSelectedVoiceURI(vs[0].voiceURI);
            }
        }
      }
    };
    
    // Chrome/Edge loads voices asynchronously
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoiceURI]);

  const speakText = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;
    
    // Optimization: Don't interrupt if it's the exact same text (reduces choppy audio)
    if (window.speechSynthesis.speaking) {
         window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN'; 
    
    const activeVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (activeVoice) {
        utterance.voice = activeVoice;
    } else {
        const viVoice = voices.find(v => v.lang.includes('vi'));
        if (viVoice) utterance.voice = viVoice;
    }
    
    utterance.rate = 0.9; 
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, [isMuted, voices, selectedVoiceURI]);

  const handleTestVoice = () => {
      speakText("A lô một hai ba bốn, Lô tô vui xin chào các bạn!");
  };

  // --- MQTT Helpers ---
  const getHostTopic = (code: string) => `${TOPIC_PREFIX}/${code}/host`;
  const getClientTopic = (code: string) => `${TOPIC_PREFIX}/${code}/client`;
  const getChatTopic = (code: string) => `${TOPIC_PREFIX}/${code}/chat`;

  const setupMqttClient = useCallback((clientId: string, onConnect: () => void) => {
    try {
        const client = mqtt.connect(BROKER_URL, {
            clientId,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30 * 1000,
            // Optimization: Skip some validation for speed if broker allows
            reschedulePings: true,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });

        client.on('connect', () => {
            console.log('MQTT Connected');
            // Do NOT setIsConnecting(false) here yet for guests, wait for first valid state
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
    isConnectingRef.current = true; // Sync ref immediately
    setConnectionError('');
    if (clientRef.current) clientRef.current.end();

    const shortCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const myId = `host-${Date.now()}`;
    
    setPlayerId(myId);
    playerIdRef.current = myId; // Sync ref immediately

    const client = setupMqttClient(myId, () => {
        setIsConnecting(false); // Host connects immediately
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
        setChatMessages([]); // Reset chat
        client.subscribe([getClientTopic(shortCode), getChatTopic(shortCode)], (err) => {
            if (!err) publishState(client, shortCode, initialState);
        });
    });

    if (client) {
        client.on('message', (topic, message) => {
            if (topic === getChatTopic(shortCode)) {
                handleChatMessage(message);
            } else {
                handleHostMessage(topic, message);
            }
        });
        clientRef.current = client;
    }
  };

  const joinRoom = (playerName: string, roomCodeInput: string) => {
    const roomCode = roomCodeInput.trim().toUpperCase();
    
    setIsConnecting(true);
    isConnectingRef.current = true; // Sync ref immediately
    setConnectionError('');
    if (clientRef.current) clientRef.current.end();

    const myId = `player-${Date.now()}`;
    setPlayerId(myId);
    playerIdRef.current = myId; // Sync ref immediately

    const joinTimeout = setTimeout(() => {
        if (isConnectingRef.current) {
            setConnectionError("Không tìm thấy phòng hoặc mạng chậm. Hãy kiểm tra lại mã phòng.");
            setIsConnecting(false);
            if (clientRef.current) clientRef.current.end();
        }
    }, 10000);

    const client = setupMqttClient(myId, () => {
        // Optimistically set code to ensure chat topic generation works locally immediately
        setGameState(prev => ({ ...prev, code: roomCode }));

        client.subscribe([getHostTopic(roomCode), getChatTopic(roomCode)], (err) => {
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
            // IMPORTANT: clearTimeout on FIRST message (either state or chat)
            clearTimeout(joinTimeout);
            
            // Check strictly both Chat Topic and Host Topic
            if (topic === getChatTopic(roomCode)) {
                handleChatMessage(message);
            } else if (topic === getHostTopic(roomCode)) {
                handleGuestMessage(topic, message);
            }
        });
        clientRef.current = client;
    }
  };

  const leaveRoom = () => {
      const me = gameState.players.find(p => p.id === playerId);
      if (clientRef.current) {
          if (!me?.isHost) {
               // Send leave message to host
               clientRef.current.publish(getClientTopic(gameState.code), JSON.stringify({
                  type: 'PLAYER_LEAVE',
                  playerId: playerId
               }));
          }
          clientRef.current.end();
      }
      
      // Reset state
      setGameState(INITIAL_STATE);
      setChatMessages([]);
      setPlayerId('');
      setIsConnecting(false);
      setUnreadChatCount(0);
      setIsChatOpen(false);
  };

  const kickPlayer = (targetPlayerId: string) => {
      const me = gameState.players.find(p => p.id === playerId);
      if (!me?.isHost) return;

      // Host deletes player locally then broadcasts
      const newState = {
          ...gameState,
          players: gameState.players.filter(p => p.id !== targetPlayerId)
      };
      setGameState(newState);
      if (clientRef.current) publishState(clientRef.current, gameState.code, newState);
  };

  // --- Logic for Ready / Customize ---

  const handleToggleReady = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (!me) return;
    const newReadyStatus = !me.isReady;
    updatePlayerLocallyAndBroadcast(playerId, { isReady: newReadyStatus });
  };

  // --- Rename Features ---
  const handleOpenRename = () => {
    const me = gameState.players.find(p => p.id === playerId);
    if (me) {
        setRenameValue(me.name);
        setIsRenameModalOpen(true);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim()) {
        updatePlayerLocallyAndBroadcast(playerId, { name: renameValue.trim() });
        setIsRenameModalOpen(false);
    }
  };

  const updatePlayerLocallyAndBroadcast = (pId: string, changes: Partial<Player>) => {
      const myId = playerIdRef.current;
      const currentRefState = gameStateRef.current;

      // Update Local
      setGameState(prev => {
          const updatedPlayers = prev.players.map(p => p.id === pId ? { ...p, ...changes } : p);
          const newState = { ...prev, players: updatedPlayers };
          // If I am host, broadcast state using LATEST ref data
          const me = prev.players.find(p => p.id === myId);
          if (me?.isHost && clientRef.current) {
              publishState(clientRef.current, prev.code, newState);
          }
          return newState;
      });

      // If I am guest, send update request using LATEST ref data
      // We use currentRefState instead of gameState closure to avoid staleness
      const me = currentRefState.players.find(p => p.id === myId);
      if (me && !me.isHost && clientRef.current) {
           clientRef.current.publish(getClientTopic(currentRefState.code), JSON.stringify({
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
      localMarkedNumbersRef.current.clear(); // Clear local marks if sheets change
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
      localMarkedNumbersRef.current.clear();
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
      localMarkedNumbersRef.current.clear();
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
      client.publish(getHostTopic(code), payload, { retain: true, qos: 0 }); // Use QoS 0 for speed
  };

  const handleChatMessage = (message: any) => {
      try {
          const chatMsg: ChatMessage = JSON.parse(message.toString());
          setChatMessages(prev => [...prev, chatMsg]);
          
          if (!isChatOpenRef.current) {
              setUnreadChatCount(prev => prev + 1);
          }
      } catch (e) {
          console.error("Error parsing chat message", e);
      }
  };

  const handleHostMessage = (topic: string, message: any) => {
      try {
          const data = JSON.parse(message.toString());
          const currentState = gameStateRef.current;
          let newState = { ...currentState };
          let shouldBroadcast = false; // Separate broadcast flag from local update
          let shouldUpdateLocal = false;

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
                  shouldUpdateLocal = true;
                  shouldBroadcast = true; // Always broadcast join
                  
                  // Send system chat message
                  sendChatMessage(`đã tham gia phòng`, true, newPlayer.name);
              }
          } 
          else if (data.type === 'PLAYER_LEAVE') {
              const pName = currentState.players.find(p => p.id === data.playerId)?.name;
              newState.players = currentState.players.filter(p => p.id !== data.playerId);
              shouldUpdateLocal = true;
              shouldBroadcast = true;
              if (pName) sendChatMessage(`đã rời phòng`, true, pName);
          }
          else if (data.type === 'MARK_UPDATE') {
              // OPTIMIZATION: Only broadcast if Waiting status CHANGED
              newState.players = currentState.players.map(p => {
                  if (p.id === data.playerId) {
                      const wasWaiting = p.isWaiting;
                      if (wasWaiting !== data.isWaiting) {
                          shouldBroadcast = true; // Waiting status changed, tell everyone
                      }
                      return { 
                          ...p, 
                          markedNumbers: new Set<number>(data.markedNumbers),
                          isWaiting: data.isWaiting 
                      };
                  }
                  return p;
              });
              shouldUpdateLocal = true;
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
              shouldUpdateLocal = true;
              shouldBroadcast = true; // Player config change usually happens in lobby, keep synced
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
                      shouldUpdateLocal = true;
                      shouldBroadcast = true; // WIN is critical
                  }
              }
          }

          if (shouldUpdateLocal) {
              setGameState(newState);
          }
          
          if (shouldBroadcast && clientRef.current) {
              publishState(clientRef.current, currentState.code, newState);
          }

      } catch (e) {
          console.error("Error parsing host message", e);
      }
  };

  const handleGuestMessage = (topic: string, message: any) => {
      try {
          const remoteState = JSON.parse(message.toString());
          const myId = playerIdRef.current;
          
          // CRITICAL FIX: Conflict resolution.
          // If the player in the incoming state is ME, and I am already efficiently playing (not connecting),
          // I trust my `localMarkedNumbersRef` MORE than the server's outdated state.
          // This prevents the server from wiping out my recent clicks.
          const hydratedPlayers: Player[] = remoteState.players.map((p: any) => {
              const serverMarks = new Set<number>(p.markedNumbers as number[]);
              
              if (p.id === myId && !isConnectingRef.current) {
                  return {
                      ...p,
                      markedNumbers: new Set(localMarkedNumbersRef.current) // Keep local state
                  };
              }

              return {
                  ...p,
                  markedNumbers: serverMarks
              };
          });

          const amInList = hydratedPlayers.find(p => p.id === myId);

          // FIX RACE CONDITION & "RELOAD" ISSUE:
          // Previously, if a player was temporarily missing from the host's state (due to lag or reset), we kicked them out.
          // Now, we simply ignore the update if we are not in it, preventing the "Reload" to lobby effect.
          // Only explicit disconnects or manual leaves should trigger leaveRoom.
          if (!amInList) {
              if (isConnectingRef.current) {
                  return; // Waiting for join
              } else {
                  // Do NOT leaveRoom() here. Just ignore this frame.
                  console.warn("Client not found in server state - ignoring update to prevent kick.");
                  return; 
              }
          }

          // If found, I am successfully connected
          if (isConnectingRef.current) {
              setIsConnecting(false);
              // Only sync from server to local ONCE when re-joining or first connecting
              if (amInList) {
                  localMarkedNumbersRef.current = new Set(amInList.markedNumbers);
              }
          }

          setGameState({
              ...remoteState,
              players: hydratedPlayers,
          });
      } catch (e) {
          console.error("Error parsing guest message", e);
      }
  };

  const sendChatMessage = (text: string, isSystem = false, systemName = '') => {
      const me = gameStateRef.current.players.find(p => p.id === playerIdRef.current);
      if (!me && !isSystem) return;

      const msg: ChatMessage = {
          id: Date.now().toString() + Math.random(),
          playerId: isSystem ? 'system' : me!.id,
          playerName: isSystem ? (systemName || 'Hệ thống') : me!.name,
          text: text,
          timestamp: Date.now(),
          isSystem
      };

      if (clientRef.current) {
          // Use current state code if available, otherwise assume we are in setup phase
          const topic = getChatTopic(gameStateRef.current.code);
          clientRef.current.publish(topic, JSON.stringify(msg));
      }
  };

  // --- Game Loop (Host Only) ---

  const startGame = useCallback(() => {
    const currentState = gameStateRef.current;
    
    // Filter only READY players to join the game
    const readyPlayers = currentState.players.filter(p => p.status === 'playing' && p.isReady);
    
    if (readyPlayers.length === 0) {
        alert("Cần ít nhất 1 người chơi sẵn sàng để bắt đầu!");
        return;
    }

    // Prepare new state
    let roundPot = 0;
    const updatedPlayers = currentState.players.map(p => {
        if (p.status === 'playing') {
            if (p.isReady) {
                 // Active player: Pay money
                 const cost = p.sheetCount * currentState.betPrice;
                 roundPot += cost;
                 return { ...p, balance: p.balance - cost };
            } else {
                 // Not ready: Move to spectator
                 return { ...p, status: 'spectating' as const };
            }
        }
        return p;
    });

    const startCommentary = 'Trò chơi bắt đầu! Chuẩn bị dò số nào...';
    const newState: RoomState = {
        ...currentState,
        players: updatedPlayers,
        status: 'playing',
        mcCommentary: startCommentary,
        pot: roundPot
    };

    // Apply state and side effects
    setGameState(newState);
    speakText(startCommentary);
    
    if (clientRef.current) publishState(clientRef.current, currentState.code, newState);
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
    // Always publish state when drawing a number - this syncs everything
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
        // Do NOT publish state here just for text update, it might cause lag.
        // Guests can generate their own or receive it in next draw?
        // Actually for MC we need to send it.
        // But let's check if we can skip if network is busy? No, MC is fun.
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

  const handleMarkNumber = useCallback((num: number) => {
    const currentGameState = gameStateRef.current;
    if (currentGameState.status !== 'playing') return;
    
    const myPId = playerIdRef.current;
    const me = currentGameState.players.find(p => p.id === myPId);

    if (!me || me.status === 'spectating') return;

    // Use local ref as source of truth for current interaction
    const isMarkedLocal = localMarkedNumbersRef.current.has(num);

    // FIX: Always allow UNMARKING (fixing mistakes), even if calledNumbers is desynced.
    // For MARKING, strictly check if called.
    if (!isMarkedLocal && !currentGameState.calledNumbers.includes(num)) {
      alert("Số này chưa được gọi!");
      return;
    }

    // 1. Update LOCAL REF instantly (Atomic operation)
    if (isMarkedLocal) {
        localMarkedNumbersRef.current.delete(num);
    } else {
        localMarkedNumbersRef.current.add(num);
    }
    
    // Create a new Set for React State to trigger re-render
    const newMarked = new Set(localMarkedNumbersRef.current);
    const isWaiting = checkWaiting(me.sheets, newMarked);

    // 2. Update React State Optimistically using Functional Update
    // We use the 'newMarked' we just calculated from the Ref, ensuring
    // we don't lose previous clicks even if 'prev' state was stale regarding the *logic*,
    // but we use 'prev' to merge into the object structure correctly.
    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === myPId ? { ...p, markedNumbers: newMarked, isWaiting: isWaiting } : p
      );
      const newState = { ...prev, players: updatedPlayers };
      
      if (me.isHost && clientRef.current) {
          if (me.isWaiting !== isWaiting) {
              publishState(clientRef.current, prev.code, newState);
          }
      }
      return newState;
    });

    // 3. Send MQTT update ONLY if waiting status CHANGED
    if (!me.isHost && clientRef.current) {
        if (me.isWaiting !== isWaiting) {
             clientRef.current.publish(getClientTopic(currentGameState.code), JSON.stringify({
                type: 'MARK_UPDATE',
                playerId: myPId,
                markedNumbers: Array.from(newMarked),
                isWaiting: isWaiting
            }));
        }
    }
  }, []); // Empty dependency array = stable function reference for Ticket memo

  const handleKinhCall = useCallback(() => {
    const currentGameState = gameStateRef.current;
    const myPId = playerIdRef.current;
    const me = currentGameState.players.find(p => p.id === myPId);
    
    if (!me || me.status === 'spectating') return;

    const winningRow = checkWin(me.sheets, me.markedNumbers);

    if (winningRow) {
        if (me.isHost) {
             const newState = {
                ...currentGameState,
                status: 'ended' as GameStatus,
                winner: me,
                winningNumbers: winningRow,
                mcCommentary: `CHÚC MỪNG! ${me.name} ĐÃ KINH RỒI!`,
                pot: 0,
                players: currentGameState.players.map(p => 
                  p.id === me.id ? { ...p, balance: p.balance + currentGameState.pot } : p
                )
             };
             
             setGameState(newState);
             speakText(newState.mcCommentary); 
             
             if (clientRef.current) publishState(clientRef.current, currentGameState.code, newState);
             if (callIntervalRef.current) clearInterval(callIntervalRef.current);

        } else {
            if (clientRef.current) {
                clientRef.current.publish(getClientTopic(currentGameState.code), JSON.stringify({
                    type: 'BINGO_CLAIM',
                    playerId: myPId,
                    markedNumbers: Array.from(me.markedNumbers)
                }));
            }
        }
    } else {
      alert('Khoan đã! Bạn chưa đủ điều kiện KINH đâu nhé! Kiểm tra lại đi.');
    }
  }, [speakText]);

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
  
  // Calculate readiness for button display
  const readyPlayers = gameState.players.filter(p => p.status === 'playing' && p.isReady);
  const readyCount = readyPlayers.length;
  const totalPotEstimate = readyPlayers.reduce((sum, p) => sum + (p.sheetCount * gameState.betPrice), 0);
  
  // For validation, we still need at least 1 ready player
  const canStart = readyCount > 0;

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
              {me && (
                  <button onClick={leaveRoom} className="btn" style={{padding: '0.25rem', background: 'transparent', border: '1px solid #white', color: 'white'}} title="Thoát phòng">
                     <LogOut size={20} />
                  </button>
              )}
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
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold">{me.name}</h3>
                                    <button onClick={handleOpenRename} className="btn-icon" style={{width: '24px', height: '24px', padding: 0}} title="Đổi tên">
                                        <Pencil size={14} />
                                    </button>
                                </div>
                                <span className="text-sm font-bold text-muted">({me.sheets.length} Lá)</span>
                            </div>
                            
                            <div className={`ticket-grid ${me.sheets.length === 1 ? 'single-ticket' : ''}`}>
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
                                    <div className="text-right flex items-center gap-2">
                                        {p.isReady ? (
                                            <span style={{color: '#16a34a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <CheckCircle2 size={16} /> Sẵn sàng
                                            </span>
                                        ) : (
                                            <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'}}>
                                                <Loader2 size={16} className="animate-spin" /> Đang chọn ({p.sheetCount} lá)
                                            </span>
                                        )}
                                        {isHost && p.id !== playerId && (
                                            <button 
                                                onClick={() => kickPlayer(p.id)}
                                                className="btn-icon" 
                                                title="Đuổi khỏi phòng"
                                                style={{color: '#ef4444', width: '28px', height: '28px', padding: 0}}
                                            >
                                                <X size={16} />
                                            </button>
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
                                disabled={!canStart}
                                className="btn btn-primary w-full"
                                style={{padding: '1rem', fontSize: '1.2rem', opacity: !canStart ? 0.5 : 1}}
                            >
                                {!canStart 
                                    ? 'CẦN ÍT NHẤT 1 NGƯỜI SẴN SÀNG' 
                                    : <><Play size={24}/> BẮT ĐẦU NGAY ({formatCurrency(totalPotEstimate)})</>
                                }
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
                        <button onClick={handleOpenRename} className="btn-icon" style={{width: '28px', height: '28px', marginLeft: '0.5rem'}} title="Đổi tên">
                            <Pencil size={14} />
                        </button>
                    </div>
                    
                    {me && isSpectator ? (
                        <div className="card text-center p-8 bg-gray-100 border-dashed border-2 border-gray-300">
                             <Eye size={48} className="mx-auto text-gray-400 mb-2" />
                             <h3 className="text-lg font-bold text-gray-600">Chế độ Khán Giả</h3>
                             <p className="text-gray-500">Bạn vào sau khi ván đã bắt đầu. Vui lòng đợi ván sau nhé!</p>
                        </div>
                    ) : (
                        <div className={`ticket-grid ${me && me.sheets.length === 1 ? 'single-ticket' : ''}`}>
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
                                    style={{border: 'none', background: 'transparent', color: '#6b7280', maxWidth: '140px', fontSize: '0.75rem', cursor: 'pointer', outline: 'none', textOverflow: 'ellipsis'}}
                                >
                                    {voices.length === 0 && <option value="">Đang tải giọng...</option>}
                                    {[...voices].sort((a, b) => {
                                        // Prioritize 'vi-VN' or 'vi' lang
                                        const aVi = a.lang.includes('vi') ? 1 : 0;
                                        const bVi = b.lang.includes('vi') ? 1 : 0;
                                        return bVi - aVi;
                                    }).map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name.slice(0, 25)}{v.name.length > 25 ? '...' : ''}</option>)}
                                </select>
                                <button onClick={handleTestVoice} className="p-1 rounded hover:bg-gray-200" title="Test loa"><Mic size={12}/></button>
                            </div>
                        </div>
                    </div>
                    
                    <div style={{minHeight: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                        {mcLoading ? (
                            <span style={{color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                <Loader2 className="animate-spin" size={16} /> ...
                            </span>
                        ) : (
                            <p 
                              className="mc-text cursor-pointer hover:text-red-700 active:scale-95 transition-all" 
                              style={{fontSize: '1.1rem'}}
                              onClick={() => speakText(gameState.mcCommentary)}
                              title="Bấm để đọc lại"
                            >
                              "{gameState.mcCommentary}"
                            </p>
                        )}
                    </div>

                    {gameState.currentNumber && (
                        <div className="current-number" style={{width: '5rem', height: '5rem', fontSize: '2.5rem', marginTop: '0.5rem'}}>
                            {gameState.currentNumber}
                        </div>
                    )}
                    
                    {gameState.calledNumbers.length > 1 && (
                         <div style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem'}}>
                             <span style={{fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold', textTransform: 'uppercase'}}>Vừa qua</span>
                             <div style={{display: 'flex', gap: '0.5rem'}}>
                                 {gameState.calledNumbers.slice(0, -1).slice(-5).map((num, i) => (
                                     <div key={i} style={{
                                         width: '2rem', height: '2rem', 
                                         borderRadius: '50%', 
                                         background: 'rgba(255,255,255,0.6)', 
                                         border: '1px solid #d1d5db',
                                         display: 'flex', alignItems: 'center', justifyContent: 'center',
                                         fontWeight: 'bold', color: '#6b7280',
                                         fontSize: '0.9rem'
                                     }}>
                                         {num}
                                     </div>
                                 ))}
                             </div>
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
                  <h2 style={{fontSize: '2.25rem', fontWeight: '800', color: '#dc2626', marginBottom: '1.5rem', textTransform: 'uppercase', textAlign: 'center'}}>
                      Chiến Thắng!
                  </h2>
                  
                  <div className="modal-body-flex">
                      <div className="modal-left">
                          <div className="modal-icon animate-bounce">
                            <Trophy size={48} style={{color: '#ca8a04'}} />
                          </div>
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
                      
                      <div className="modal-right">
                          <div className="modal-board-section">
                               <p style={{fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', textAlign: 'center'}}>Bảng Số Đã Gọi</p>
                               <div style={{transform: 'scale(0.95)', transformOrigin: 'top center'}}>
                                 <NumberBoard calledNumbers={gameState.calledNumbers} currentNumber={null} />
                               </div>
                          </div>
                      </div>
                  </div>

                </div>
              </div>
            )}
            
            {/* Chat Box */}
            <ChatBox 
                messages={chatMessages} 
                currentPlayerId={playerId} 
                onSendMessage={(text) => sendChatMessage(text)}
                isOpen={isChatOpen}
                setIsOpen={setIsChatOpen}
                unreadCount={unreadChatCount}
            />
          </div>
        )}

        {/* Rename Modal */}
        {isRenameModalOpen && (
            <div className="overlay">
                <div className="modal animate-in fade-in zoom-in" style={{maxWidth: '28rem', padding: '0', overflow: 'hidden', border: 'none', borderRadius: '1rem'}}>
                    {/* Header */}
                    <div style={{background: 'var(--primary)', color: 'white', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}>
                         <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                            <div style={{background: 'rgba(255,255,255,0.2)', padding: '0.5rem', borderRadius: '50%', display: 'flex'}}>
                                <UserCircle2 size={24} color="white" />
                            </div>
                            <h3 className="text-lg font-extrabold" style={{margin: 0, letterSpacing: '0.025em'}}>CẬP NHẬT HỒ SƠ</h3>
                         </div>
                         <button onClick={() => setIsRenameModalOpen(false)} style={{background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.8, transition: 'opacity 0.2s', padding: '0.25rem', display: 'flex'}} className="hover:opacity-100">
                            <X size={24} />
                         </button>
                    </div>
                    
                    {/* Body */}
                    <div style={{padding: '2rem'}}>
                        <form onSubmit={handleRenameSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-muted mb-2" style={{textTransform: 'uppercase', letterSpacing: '0.05em'}}>Tên hiển thị mới</label>
                                <div className="input-wrapper" style={{position: 'relative'}}>
                                    <input 
                                        type="text"
                                        className="form-input"
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        autoFocus
                                        maxLength={20}
                                        placeholder="Nhập tên của bạn..."
                                        style={{
                                            fontSize: '1.1rem', 
                                            padding: '1rem 1rem 1rem 3rem',
                                            width: '100%',
                                            border: '2px solid #e5e7eb',
                                            borderRadius: '0.75rem',
                                            outline: 'none',
                                            transition: 'all 0.2s'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                                        onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                                    />
                                    <div style={{position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none'}}>
                                        <Pencil size={20} />
                                    </div>
                                </div>
                                <p style={{fontSize: '0.8rem', color: '#6b7280', marginTop: '0.75rem', display: 'flex', gap: '0.25rem'}}>
                                    <span style={{color: 'var(--primary)'}}>*</span> Tên này sẽ hiển thị trên bảng xếp hạng và vé của bạn.
                                </p>
                            </div>
                            
                            <div className="flex gap-3 justify-end mt-8">
                                <button type="button" onClick={() => setIsRenameModalOpen(false)} className="btn" style={{background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb'}}>
                                    Hủy Bỏ
                                </button>
                                <button type="submit" disabled={!renameValue.trim()} className="btn btn-primary" style={{flex: 1, boxShadow: '0 4px 6px -1px rgba(220, 38, 38, 0.3)'}}>
                                    <Save size={20} /> Lưu Thay Đổi
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;