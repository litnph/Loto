import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Minus, ThumbsUp } from 'lucide-react';
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
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  // Avatar color generator
  const getAvatarColor = (name: string) => {
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Render Floating Button if Closed
  if (!isOpen) {
    return (
      <div className="chat-floating-btn" onClick={() => setIsOpen(true)}>
        <MessageCircle size={24} />
        {unreadCount > 0 && (
          <div className="chat-unread-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </div>
        )}
        <style>{`
          .chat-floating-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            background-color: white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10000;
            transition: transform 0.2s;
            color: #0084ff; /* Messenger Blue Icon */
          }
          .chat-floating-btn:hover {
            transform: scale(1.1);
            background-color: #f9f9f9;
          }
          .chat-unread-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background-color: #fa3e3e;
            color: white;
            font-size: 11px;
            font-weight: bold;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid white;
          }
        `}</style>
      </div>
    );
  }

  // Render Chat Window
  return (
    <div className="chat-window">
      
      {/* 1. Header */}
      <div className="chat-header">
        <div className="chat-header-user">
          <div className="chat-header-avatar">
            <MessageCircle size={18} color="white" />
            <div className="status-dot"></div>
          </div>
          <div className="chat-header-info">
            <span className="name">Phòng Chat Lô Tô</span>
            <span className="status">Đang hoạt động</span>
          </div>
        </div>
        <div className="chat-header-actions">
          <Minus size={20} className="header-icon" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
          <X size={20} className="header-icon" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
        </div>
      </div>

      {/* 2. Messages Body */}
      <div className="chat-body custom-scrollbar">
        <div className="chat-intro">
           <div className="intro-avatar">
              <MessageCircle size={32} />
           </div>
           <h3>Loto Vui Online</h3>
           <p>Chào mừng bạn đến với phòng chat!</p>
        </div>

        {messages.map((msg, index) => {
          const isMe = msg.playerId === currentPlayerId;
          const isSystem = msg.isSystem;
          const isLastFromUser = index === messages.length - 1 || messages[index + 1]?.playerId !== msg.playerId;
          
          if (isSystem) {
             return (
               <div key={msg.id} className="msg-system">
                 <span>{msg.playerName} {msg.text}</span>
               </div>
             );
          }

          return (
            <div key={msg.id} className={`msg-row ${isMe ? 'msg-me' : 'msg-other'}`}>
               {!isMe && (
                 <div className="msg-avatar" style={{visibility: isLastFromUser ? 'visible' : 'hidden'}}>
                    {/* Simplified avatar circle */}
                    <div className="avatar-circle" style={{background: getAvatarColor(msg.playerName)}}>
                      {msg.playerName.charAt(0).toUpperCase()}
                    </div>
                 </div>
               )}
               
               <div className="msg-content">
                  {!isMe && isLastFromUser && <span className="msg-name">{msg.playerName}</span>}
                  <div className="msg-bubble" title={new Date(msg.timestamp).toLocaleTimeString()}>
                    {msg.text}
                  </div>
               </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 3. Footer (Input) */}
      <div className="chat-footer">
        <form onSubmit={handleSubmit} className="input-container">
           <input 
             ref={inputRef}
             type="text" 
             placeholder="Aa" 
             value={inputText}
             onChange={(e) => setInputText(e.target.value)}
           />
        </form>

        <div className="send-action" onClick={handleSubmit}>
           {inputText.trim() ? (
             <Send size={20} color="#0084ff" style={{marginLeft: '8px', cursor: 'pointer'}} />
           ) : (
             <ThumbsUp size={20} color="#0084ff" style={{marginLeft: '8px', cursor: 'pointer'}} />
           )}
        </div>
      </div>

      <style>{`
        .chat-window {
          position: fixed;
          bottom: 0;
          right: 80px;
          width: 338px;
          height: 455px;
          background: white;
          border-radius: 8px 8px 0 0;
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
          z-index: 10000;
          display: flex;
          flex-direction: column;
          font-family: Helvetica, Arial, sans-serif;
          overflow: hidden;
        }
        
        /* HEADER */
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-bottom: 1px solid #e5e5e5;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .chat-header-user {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        .chat-header-avatar {
          width: 32px;
          height: 32px;
          background: #0084ff; /* Brand color */
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .status-dot {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 10px;
          height: 10px;
          background: #31a24c;
          border: 2px solid white;
          border-radius: 50%;
        }
        .chat-header-info {
          display: flex;
          flex-direction: column;
        }
        .chat-header-info .name {
          font-weight: bold;
          font-size: 14px;
          color: #050505;
        }
        .chat-header-info .status {
          font-size: 12px;
          color: #65676b;
        }
        .chat-header-actions {
          display: flex;
          gap: 12px;
        }
        .header-icon {
          color: #0084ff; /* Messenger Purple/Blue */
          cursor: pointer;
        }
        .header-icon:hover {
          opacity: 0.8;
        }

        /* BODY */
        .chat-body {
          flex: 1;
          background: white;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .chat-intro {
           text-align: center;
           margin-top: 20px;
           margin-bottom: 40px;
           color: #65676b;
        }
        .intro-avatar {
           width: 60px;
           height: 60px;
           margin: 0 auto 10px auto;
           border-radius: 50%;
           background: #f0f2f5;
           display: flex;
           align-items: center;
           justify-content: center;
        }

        /* MESSAGES */
        .msg-row {
          display: flex;
          margin-bottom: 2px;
          align-items: flex-end;
        }
        .msg-me {
          justify-content: flex-end;
        }
        .msg-other {
          justify-content: flex-start;
        }
        
        .msg-avatar {
          width: 28px;
          height: 28px;
          margin-right: 8px;
          margin-bottom: 4px; /* Align with bottom of bubble */
        }
        .avatar-circle {
           width: 100%;
           height: 100%;
           border-radius: 50%;
           color: white;
           font-size: 10px;
           font-weight: bold;
           display: flex;
           align-items: center;
           justify-content: center;
        }

        .msg-content {
          display: flex;
          flex-direction: column;
          max-width: 70%;
        }
        .msg-name {
          font-size: 10px;
          color: #65676b;
          margin-bottom: 2px;
          margin-left: 2px;
        }
        .msg-bubble {
          padding: 8px 12px;
          font-size: 14px;
          line-height: 1.4;
          word-wrap: break-word;
        }

        /* Self Styling */
        .msg-me .msg-bubble {
          background-color: #0084ff;
          color: white;
          border-radius: 18px 18px 4px 18px; /* TopL, TopR, BotR, BotL */
        }
        .msg-me + .msg-me .msg-bubble {
           border-radius: 18px 4px 4px 18px; /* Stacked look */
        }
        
        /* Other Styling */
        .msg-other .msg-bubble {
          background-color: #f0f0f0;
          color: #050505;
          border-radius: 18px 18px 18px 4px;
        }

        .msg-system {
          text-align: center;
          margin: 10px 0;
        }
        .msg-system span {
          font-size: 11px;
          color: #65676b;
          background: #f0f2f5;
          padding: 4px 8px;
          border-radius: 10px;
        }

        /* FOOTER */
        .chat-footer {
          padding: 8px;
          display: flex;
          align-items: center;
          border-top: 1px solid transparent;
        }

        .input-container {
          flex: 1;
          position: relative;
          background: #f0f2f5;
          border-radius: 20px;
          display: flex;
          align-items: center;
        }
        .input-container input {
          width: 100%;
          border: none;
          background: transparent;
          padding: 8px 12px;
          font-size: 14px;
          outline: none;
          color: #050505;
        }

        /* Scrollbar */
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
};

export default ChatBox;