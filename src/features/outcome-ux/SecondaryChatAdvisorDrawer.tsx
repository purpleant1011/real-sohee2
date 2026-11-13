'use client';
import React, { useState } from 'react';

export interface SecondaryChatAdvisorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSendMessage: (message: string) => void;
}

export const SecondaryChatAdvisorDrawer: React.FC<SecondaryChatAdvisorDrawerProps> = ({
  isOpen,
  onClose,
  onSendMessage,
}) => {
  const [inputVal, setInputVal] = useState('');

  if (!isOpen) return null;

  const handleSend = () => {
    if (!inputVal.trim()) return;
    onSendMessage(inputVal);
    setInputVal('');
  };

  const handleQuickQuestion = (q: string) => {
    onSendMessage(q);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col font-sans">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div>
          <h2 className="text-base font-bold text-slate-900">소희 어드바이저</h2>
          <p className="text-xs text-slate-500">전략 조율 및 빠른 질의응답 (보조 인터페이스)</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
        >
          ✕
        </button>
      </div>

      {/* Suggested Quick Questions */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-2">
        <div className="text-xs font-semibold text-slate-500">추천 빠른 질의</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleQuickQuestion('오늘 뭐 하고 있어?')}
            className="px-3 py-1 text-xs bg-indigo-50 text-indigo-700 rounded-full hover:bg-indigo-100 transition border border-indigo-200 font-medium"
          >
            오늘 뭐 하고 있어?
          </button>
          <button
            type="button"
            onClick={() => handleQuickQuestion('이번 주는 비용 아껴줘')}
            className="px-3 py-1 text-xs bg-slate-100 text-slate-700 rounded-full hover:bg-slate-200 transition border border-slate-300 font-medium"
          >
            이번 주는 비용 아껴줘
          </button>
        </div>
      </div>

      {/* Chat Body */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 text-sm text-slate-700">
        <div className="bg-slate-100 p-3 rounded-lg text-xs leading-relaxed">
          안녕하세요! 소희는 백그라운드에서 상시 목표를 향해 자율 작동 중입니다. 궁금한 점이나 전략 수정 요청을 말씀해 주세요.
        </div>
      </div>

      {/* Input Footer */}
      <div className="p-4 border-t border-slate-200 flex gap-2">
        <input
          type="text"
          placeholder="소희에게 요청 또는 조율사항 입력..."
          className="flex-1 p-2 text-base md:text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          className="px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
        >
          전송
        </button>
      </div>
    </div>
  );
};
