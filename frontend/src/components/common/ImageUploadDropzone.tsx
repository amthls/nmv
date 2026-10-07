'use client';

import React, { useState, useRef, useCallback } from 'react';
import { UploadCloud, Image as ImageIcon, X, Loader2, AlertCircle, Check } from 'lucide-react';
import SmartImage from './SmartImage';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface ImageUploadDropzoneProps {
  images: string[];
  onChange: (images: string[]) => void;
  maxFiles?: number;
  label?: string;
}

export default function ImageUploadDropzone({
  images = [],
  onChange,
  maxFiles = 10,
  label = 'Tải ảnh lên từ thiết bị của bạn',
}: ImageUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (fileArray.length === 0) {
      setErrorMsg('Vui lòng chọn file hình ảnh hợp lệ (PNG, JPG, WebP, GIF)');
      return;
    }

    if (images.length + fileArray.length > maxFiles) {
      setErrorMsg(`Chỉ được tải lên tối đa ${maxFiles} hình ảnh cho một bài viết`);
      return;
    }

    setErrorMsg(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      fileArray.forEach((file) => {
        formData.append('images', file);
      });

      const res = await fetch(`${API_BASE_URL}/upload/images`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.urls) {
          onChange([...images, ...json.data.urls]);
        }
      } else {
        const json = await res.json();
        setErrorMsg(json.message || 'Lỗi khi tải ảnh lên server');
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
      setErrorMsg('Không thể kết nối đến server tải ảnh');
    } finally {
      setIsUploading(false);
    }
  }, [images, maxFiles, onChange]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeImage = (indexToRemove: number) => {
    onChange(images.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" /> {label} ({images.length}/{maxFiles})
        </label>
        {images.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-rose-400 hover:underline font-semibold"
          >
            Xóa tất cả ảnh
          </button>
        )}
      </div>

      {/* Hidden Native File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Drag and Drop Box */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/15 scale-[1.01]'
            : 'border-white/15 bg-white/5 hover:border-cyan-500/50 hover:bg-white/10'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-2">
          {isUploading ? (
            <>
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <span className="text-xs text-cyan-300 font-semibold">Đang tải ảnh từ máy của bạn lên...</span>
            </>
          ) : (
            <>
              <div className="p-3 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">
                  Nhấn để chọn ảnh từ máy hoặc kéo thả ảnh vào đây
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Hỗ trợ PNG, JPG, WebP, GIF (Chọn cùng lúc nhiều ảnh, tối đa {maxFiles} ảnh)
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Uploaded Images Preview Thumbnails Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 pt-1">
          {images.map((url, idx) => (
            <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border border-white/15 bg-black/40 shadow-md">
              <SmartImage src={url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
              
              {/* Badge order */}
              <span className="absolute top-1 left-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-black/70 text-white backdrop-blur-sm">
                #{idx + 1}
              </span>

              {/* Remove button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(idx);
                }}
                className="absolute top-1 right-1 p-1 rounded-full bg-rose-600/90 text-snow hover:bg-rose-500 transition opacity-0 group-hover:opacity-100 shadow-md"
                title="Xóa ảnh này"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
