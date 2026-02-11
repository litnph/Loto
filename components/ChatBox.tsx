import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Minus, ChevronDown } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatBoxProps {
  messages: ChatMessage[];
  currentPlayerId: string;
  onSendMessage: (text: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  unreadCount: number;
}

const ChatBox: React.FC<ChatBoxProps> = ({ messages, currentPlayerId, onSendMessage, isOpen, setIsOpen, unreadCount }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      // Auto focus input when opening
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event bubbling
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
      // Keep focus after sending
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  // Generate a consistent color for avatars based on name
  const getAvatarColor = (name: string) => {
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 flex items-center justify-center rounded-full shadow-xl transition-all hover:scale-110 active:scale-95 ${unreadCount > 0 ? 'animate-bounce-slight' : ''}`}
        style={{
            width: '3.5rem', 
            height: '3.5rem', 
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', 
            color: 'white',
            border: '2px solid white',
            zIndex: 9999 // Always on top
        }}
      >
        <MessageCircle size={28} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="chat-window-container" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div 
        className="chat-header"
        onClick={() => setIsOpen(false)}
      >
        <div className="flex items-center gap-2">
            <div className="relative">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <MessageCircle size={18} className="text-white" />
                </div>
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 border-2 border-blue-600 rounded-full"></div>
            </div>
            <div className="flex flex-col">
                <span className="font-bold text-white text-sm leading-tight">Phòng Chat</span>
                <span className="text-blue-100 text-xs leading-tight">Đang hoạt động</span>
            </div>
        </div>
        <div className="flex items-center gap-1">
            <button className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors">
                <Minus size={20} />
            </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="chat-body custom-scrollbar">
        <div className="flex flex-col gap-1 p-3">
            <div className="text-center text-xs text-gray-400 my-2 italic select-none">
                Bắt đầu cuộc trò chuyện
            </div>
            
            {messages.map((msg, index) => {
                const isMe = msg.playerId === currentPlayerId;
                const isSystem = msg.isSystem;
                
                // Check if previous message was from same user to group bubbles
                const isSequence = index > 0 && messages[index - 1].playerId === msg.playerId;

                if (isSystem) {
                    return (
                        <div key={msg.id} className="flex justify-center my-2">
                            <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full shadow-sm border border-gray-200">
                                {msg.playerName} {msg.text}
                            </span>
                        </div>
                    )
                }

                return (
                <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} ${isSequence ? 'mt-0.5' : 'mt-2'}`}>
                    
                    {!isMe && !isSequence && (
                        <div 
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 shadow-sm shrink-0 select-none"
                            style={{background: getAvatarColor(msg.playerName)}}
                        >
                            {msg.playerName.charAt(0).toUpperCase()}
                        </div>
                    )}
                    {!isMe && isSequence && <div className="w-8 mr-2 shrink-0"></div>}

                    <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                        {!isMe && !isSequence && (
                            <span className="text-[10px] text-gray-500 ml-1 mb-0.5 max-w-full truncate">
                                {msg.playerName}
                            </span>
                        )}
                        
                        <div 
                            className={`px-3 py-2 text-sm break-words shadow-sm relative group
                                ${isMe 
                                    ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' 
                                    : 'bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm'
                                }`}
                            title={new Date(msg.timestamp).toLocaleTimeString()}
                        >
                            {msg.text}
                        </div>
                    </div>
                </div>
                );
            })}
            <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="chat-footer">
          <form onSubmit={handleSubmit} className="relative w-full">
            <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Nhập tin nhắn..."
                className="w-full bg-gray-100 rounded-full py-3 pl-4 pr-12 outline-none text-sm text-gray-800 placeholder-gray-400 border border-transparent focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                maxLength={100}
            />
            <button 
                type="submit" 
                disabled={!inputText.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-0 disabled:scale-0 transform duration-200 shadow-sm"
            >
                <Send size={16} fill="currentColor" />
            </button>
          </form>
      </div>

      <style>{`
        .chat-window-container {
            position: fixed;
            bottom: 0;
            right: 1.5rem;
            z-index: 9999; /* Always on top */
            width: 340px;
            max-width: calc(100vw - 3rem);
            height: 480px;
            max-height: 80vh;
            background: white;
            border-top-left-radius: 1rem;
            border-top-right-radius: 1rem;
            box-shadow: 0 4px 25px rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
            animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            overflow: hidden;
            border: 1px solid rgba(0,0,0,0.1);
        }

        .chat-header {
            background: #2563eb; /* Blue 600 */
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .chat-body {
            flex: 1;
            overflow-y: auto;
            background-color: white;
            overscroll-behavior: contain;
        }

        .chat-footer {
            padding: 0.75rem;
            background: white;
            border-top: 1px solid #f3f4f6;
        }

        @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes bounce-slight {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        .animate-bounce-slight {
            animation: bounce-slight 2s infinite;
        }
      `}</style>
    </div>
  );
};

export default ChatBox;