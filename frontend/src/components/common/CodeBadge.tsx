'use client';

import React, { useState } from 'react';
import { Check, Hash } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// Parts of the smart codes (sql/migrations/017_smart_codes.sql)
const ROLES: Record<string, string> = { AD: 'Admin', MO: 'Mod', TR: 'Dịch giả', AU: 'Tác giả', RD: 'Độc giả' };
const LANGS: Record<string, string> = { JA: 'tiếng Nhật', KO: 'tiếng Hàn', ZH: 'tiếng Trung', EN: 'tiếng Anh', VI: 'tiếng Việt' };
const POST_CATS: Record<string, string> = { DS: 'Thảo luận', RV: 'Review', FA: 'Fanart', TH: 'Giả thuyết', NW: 'Tin tức', QA: 'Hỏi đáp' };
const TARGETS: Record<string, string> = { ST: 'truyện', CH: 'chương', CM: 'bình luận', PO: 'bài viết' };

const n = (s: string) => `số ${Number(s)}`;
const group = (g: string) => (g === 'G00' ? 'không nhóm' : `nhóm ${g}`);

/** "LN-JA-G03-0042-C12" → "Truyện chữ · tiếng Nhật · nhóm G03 · số 42 · chương 12" */
export function explainCode(code: string): string {
  const [head, ...p] = code.split('-');
  if (head === 'U') return ['Người dùng', ROLES[p[0]] || p[0], `tham gia 20${p[1]}`, n(p[2])].join(' · ');
  if (/^G\d+$/.test(head)) return `Nhóm dịch · ${n(head.slice(1))}`;
  if (head === 'LN' || head === 'MG') {
    const parts = [head === 'MG' ? 'Truyện tranh' : 'Truyện chữ', LANGS[p[0]] || p[0], group(p[1]), n(p[2])];
    if (p[3]) parts.push(`chương ${p[3].slice(1)}`);
    return parts.join(' · ');
  }
  if (head === 'P') return ['Bài viết', POST_CATS[p[0]] || p[0], `năm 20${p[1]}`, n(p[2])].join(' · ');
  if (head === 'AL') return ['Album', `của người dùng ${n(p[0])}`, `năm 20${p[1]}`, n(p[2])].join(' · ');
  if (head === 'RP') return ['Báo cáo', TARGETS[p[0]] || p[0], `năm 20${p[1]}`, n(p[2])].join(' · ');
  return code;
}

/**
 * Small monospace chip with the item's code; click copies it, hover explains it.
 * Admin/Mod only (readers don't need it) unless `everyone` (user codes are public).
 */
export default function CodeBadge({ code, everyone = false, className = '' }: { code?: string | null; everyone?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { hasRole } = useAuth();
  if (!code || (!everyone && !hasRole('admin', 'mod'))) return null;
  const meaning = explainCode(code);

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`${meaning}\nBấm để chép mã`}
      aria-label={`Mã ${code}: ${meaning}. Bấm để chép`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-[11px] tracking-wide text-gray-300 hover:text-white hover:border-brand-500/50 transition-colors ${className}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Hash className="w-3 h-3 text-brand-400" />}
      {code}
    </button>
  );
}
