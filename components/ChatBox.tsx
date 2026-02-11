import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, ChevronDown, ChevronUp } from 'lucide-react';
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-full shadow-lg transition-all transform hover:scale-105"
      >
        <MessageSquare size={20} />
        <span className="font-bold">Chat</span>
        {unreadCount > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full absolute -top-1 -right-1 border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 md:w-96 bg-white rounded-t-xl shadow-2xl border border-gray-200 flex flex-col" style={{height: '450px', maxHeight: '80vh'}}>
      {/* Header */}
      <div 
        className="bg-blue-600 text-white p-3 rounded-t-xl flex justify-between items-center cursor-pointer"
        onClick={() => setIsOpen(false)}
      >
        <div className="flex items-center gap-2 font-bold">
          <MessageSquare size={18} />
          <span>Trò chuyện trong phòng</span>
        </div>
        <button className="hover:bg-blue-700 p-1 rounded">
          <ChevronDown size={20} />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 bg-gray-50 flex flex-col gap-2 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm my-auto italic">
            Chưa có tin nhắn nào.<br/>Hãy gửi lời chào mọi người!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.playerId === currentPlayerId;
            const isSystem = msg.isSystem;

            if (isSystem) {
                return (
                    <div key={msg.id} className="text-center text-xs text-gray-500 my-1 italic">
                        {msg.text}
                    </div>
                )
            }

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-xs text-gray-500 ml-1 mb-0.5">{msg.playerName}</span>}
                <div 
                  className={`px-3 py-2 rounded-lg text-sm max-w-[85%] break-words shadow-sm ${
                    isMe 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Nhập tin nhắn..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
          maxLength={100}
        />
        <button 
          type="submit" 
          disabled={!inputText.trim()}
          className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};

export default ChatBox;