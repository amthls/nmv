'use client';

import React from 'react';
import { Settings, X, Type, AlignLeft, AlignJustify, Palette, Eye, Image as ImageIcon } from 'lucide-react';
import { IMAGE_QUALITY_OPTIONS, useImageQuality } from '@/lib/imageQuality';

export interface ReaderSettings {
  theme: 'dark' | 'amoled' | 'sepia' | 'light';
  fontFamily: 'Inter' | 'Noto Serif' | 'Roboto' | 'Georgia' | 'Merriweather';
  fontSize: number; // 14 to 32 px
  lineHeight: number; // 1.4 to 2.4
  maxWidth: string; // '700px' | '850px' | '1000px' | '100%'
  textAlign: 'left' | 'justify';
}

interface ReaderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onSettingsChange: (newSettings: ReaderSettings) => void;
}

export default function ReaderSettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
}: ReaderSettingsModalProps) {
  const [imageQuality, setImageQuality] = useImageQuality();

  if (!isOpen) return null;

  const themes = [
    { id: 'dark', name: 'Tối', bg: 'bg-[#12121e]', border: 'border-[#2d2d44]', text: 'text-gray-200' },
    { id: 'amoled', name: 'AMOLED', bg: 'bg-black', border: 'border-white/20', text: 'text-gray-300' },
    { id: 'sepia', name: 'Sepia (Vàng)', bg: 'bg-[#F4ECD8]', border: 'border-[#d4c5a9]', text: 'text-[#5B4636]' },
    { id: 'light', name: 'Sáng', bg: 'bg-white', border: 'border-gray-300', text: 'text-gray-900' },
  ];

  const fonts = [
    { id: 'Noto Serif', name: 'Noto Serif (Văn học)', class: 'font-serif' },
    { id: 'Inter', name: 'Inter (Hiện đại)', class: 'font-sans' },
    { id: 'Georgia', name: 'Georgia (Cổ điển)', class: 'font-serif' },
    { id: 'Roboto', name: 'Roboto (Chuẩn)', class: 'font-sans' },
  ];

  const widths = [
    { id: '720px', label: 'Hẹp' },
    { id: '860px', label: 'Vừa' },
    { id: '1000px', label: 'Rộng' },
    { id: '100%', label: 'Đầy màn hình' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div 
        className="w-full max-w-md bg-[#161626] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400">
              <Settings className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Cài Đặt Đọc Truyện</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Theme Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-brand-400" />
            <span>Màu nền đọc</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => onSettingsChange({ ...settings, theme: t.id as any })}
                className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition ${t.bg} ${t.border} ${
                  settings.theme === t.id ? 'ring-2 ring-brand-500 scale-105' : 'opacity-80 hover:opacity-100'
                }`}
              >
                <span className={`text-[11px] font-bold ${t.text}`}>{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Font Family */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-brand-400" />
            <span>Phông chữ</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {fonts.map((f) => (
              <button
                key={f.id}
                onClick={() => onSettingsChange({ ...settings, fontFamily: f.id as any })}
                className={`p-2 rounded-xl border text-xs text-left transition ${
                  settings.fontFamily === f.id
                    ? 'bg-brand-600 text-white border-brand-500 shadow-md'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                <div className="font-semibold">{f.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Font Size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-300">Cỡ chữ:</span>
            <span className="font-bold text-brand-400">{settings.fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSettingsChange({ ...settings, fontSize: Math.max(14, settings.fontSize - 1) })}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-sm flex items-center justify-center border border-white/10"
            >
              -
            </button>
            <input
              type="range"
              min="14"
              max="32"
              step="1"
              value={settings.fontSize}
              onChange={(e) => onSettingsChange({ ...settings, fontSize: parseInt(e.target.value) })}
              className="flex-1 accent-brand-500"
            />
            <button
              onClick={() => onSettingsChange({ ...settings, fontSize: Math.min(32, settings.fontSize + 1) })}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-sm flex items-center justify-center border border-white/10"
            >
              +
            </button>
          </div>
        </div>

        {/* 4. Line Height */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-300">Khoảng cách dòng:</span>
            <span className="font-bold text-brand-400">{settings.lineHeight.toFixed(1)}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1.5, 1.8, 2.0, 2.2].map((lh) => (
              <button
                key={lh}
                onClick={() => onSettingsChange({ ...settings, lineHeight: lh })}
                className={`py-1.5 rounded-lg border text-xs font-semibold transition ${
                  settings.lineHeight === lh
                    ? 'bg-brand-600 text-white border-brand-500 shadow-sm'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                {lh}x
              </button>
            ))}
          </div>
        </div>

        {/* 5. Max Width & Text Align */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-gray-400 uppercase">Khung chữ</label>
            <select
              value={settings.maxWidth}
              onChange={(e) => onSettingsChange({ ...settings, maxWidth: e.target.value })}
              className="w-full h-8 px-2.5 rounded-lg bg-[#141420] border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500"
            >
              {widths.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-gray-400 uppercase">Căn lề</label>
            <div className="flex items-center gap-1 h-8 p-0.5 rounded-lg bg-black/40 border border-white/5">
              <button
                onClick={() => onSettingsChange({ ...settings, textAlign: 'left' })}
                className={`flex-1 h-full rounded flex items-center justify-center transition ${
                  settings.textAlign === 'left' ? 'bg-brand-600 text-white' : 'text-gray-400'
                }`}
                title="Căn trái"
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onSettingsChange({ ...settings, textAlign: 'justify' })}
                className={`flex-1 h-full rounded flex items-center justify-center transition ${
                  settings.textAlign === 'justify' ? 'bg-brand-600 text-white' : 'text-gray-400'
                }`}
                title="Căn đều hai bên"
              >
                <AlignJustify className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* 6. Image resolution */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-brand-400" />
            <span>Độ phân giải ảnh</span>
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {IMAGE_QUALITY_OPTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setImageQuality(q.id)}
                title={q.hint}
                className={`py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                  imageQuality === q.id
                    ? 'bg-brand-600 border-brand-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500">
            {IMAGE_QUALITY_OPTIONS.find((q) => q.id === imageQuality)?.hint}. Áp dụng cho ảnh manga, ảnh minh họa và ảnh trong bài viết.
          </p>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md transition"
          >
            Đóng & Lưu Cài Đặt
          </button>
        </div>
      </div>
    </div>
  );
}
