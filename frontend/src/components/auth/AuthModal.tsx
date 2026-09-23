'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Lock, 
  User, 
  Mail, 
  Eye, 
  EyeOff, 
  LogIn, 
  UserPlus, 
  ShieldCheck, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle,
  KeyRound,
  Users
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function AuthModal() {
  const { 
    isAuthModalOpen, 
    closeAuthModal, 
    authModalTab, 
    login, 
    register 
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'demo'>('login');
  
  // Login Form
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register Form
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Demo Accounts
  const [demoAccounts, setDemoAccounts] = useState<any[]>([]);
  const [demoRoleFilter, setDemoRoleFilter] = useState<string>('all');
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  // The demo tab and the "default password" hint only exist when the server has demo accounts enabled
  const [demoEnabled, setDemoEnabled] = useState(false);

  // Form states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthModalOpen) {
      setActiveTab(authModalTab);
      setErrorMsg(null);
      setSuccessMsg(null);
      fetchDemoAccounts();
    }
  }, [isAuthModalOpen, authModalTab]);

  const fetchDemoAccounts = async () => {
    setIsDemoLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/accounts`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setDemoAccounts(json.data || []);
          setDemoEnabled(!json.disabled && (json.data || []).length > 0);
        }
      }
    } catch (e) {
      console.error('Failed to load demo accounts:', e);
    } finally {
      setIsDemoLoading(false);
    }
  };

  if (!isAuthModalOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) {
      setErrorMsg('Vui lòng nhập tên tài khoản/email và mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const res = await login(loginIdentifier.trim(), loginPassword);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMsg(res.message || 'Đăng nhập không thành công.');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regUsername.trim() || !regEmail.trim() || !regPassword) {
      setErrorMsg('Vui lòng điền đầy đủ các thông tin bắt buộc.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMsg('Mật khẩu xác nhận không khớp.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMsg('Mật khẩu phải từ 6 ký tự trở lên.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const res = await register({
      username: regUsername.trim(),
      email: regEmail.trim(),
      password: regPassword,
      display_name: regDisplayName.trim() || regUsername.trim(),
    });

    setIsSubmitting(false);

    if (!res.success) {
      setErrorMsg(res.message || 'Đăng ký không thành công.');
    }
  };

  const handleQuickLogin = async (username: string) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    const res = await login(username, 'password123');
    setIsSubmitting(false);
    if (!res.success) {
      setErrorMsg(res.message || 'Đăng nhập nhanh thất bại.');
    }
  };

  const filteredDemoAccounts = demoAccounts.filter((acc) => {
    if (demoRoleFilter === 'all') return true;
    return acc.roles?.includes(demoRoleFilter);
  });

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'mod':
        return 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
      case 'translator':
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
      case 'author':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      default:
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#141420] border border-white/10 shadow-2xl text-white p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-500 shadow-lg shadow-brand-500/30 mb-3">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-white via-gray-100 to-brand-300 bg-clip-text text-transparent">
            {activeTab === 'login' && 'Đăng Nhập NovelHub'}
            {activeTab === 'register' && 'Tạo Tài Khoản Mới'}
            {activeTab === 'demo' && 'Đăng Nhập Nhanh Theo Vai Trò'}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Bảo mật thông tin cá nhân, đồng bộ lịch sử đọc & bookmark trên mọi thiết bị.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-white/10 mb-6 bg-white/5 p-1 rounded-xl">
          <button
            onClick={() => { setActiveTab('login'); setErrorMsg(null); }}
            className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'login'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <LogIn className="w-4 h-4" />
            Đăng nhập
          </button>
          <button
            onClick={() => { setActiveTab('register'); setErrorMsg(null); }}
            className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'register'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Đăng ký
          </button>
          {demoEnabled && (
          <button
            onClick={() => { setActiveTab('demo'); setErrorMsg(null); }}
            className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'demo'
                ? 'bg-gradient-to-r from-indigo-600 to-brand-600 text-white shadow-md'
                : 'text-brand-400 hover:text-brand-300'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Chọn Vai Trò (Demo)
          </button>
          )}
        </div>

        {/* Error / Success Feedback */}
        {errorMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2.5 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* TAB 1: LOGIN */}
        {activeTab === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                Tên đăng nhập hoặc Email
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="admin hoặc admin@novelhub.vn"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
                  required
                />
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-300">
                  Mật khẩu
                </label>
                {demoEnabled && (
                  <span className="text-[11px] text-brand-400 hover:underline cursor-pointer" onClick={() => setActiveTab('demo')}>
                    Mật khẩu mặc định: password123
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
                  required
                />
                <KeyRound className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 mt-2 rounded-xl bg-gradient-to-r from-brand-600 via-indigo-600 to-brand-500 hover:from-brand-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Đăng Nhập
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <p className="text-xs text-gray-400">
                Chưa có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('register'); setErrorMsg(null); }}
                  className="text-brand-400 hover:text-brand-300 font-semibold ml-1"
                >
                  Đăng ký miễn phí ngay
                </button>
              </p>
            </div>
          </form>
        )}

        {/* TAB 2: REGISTER */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Tên đăng nhập (Username) *
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="Ví dụ: novel_fan99"
                  className="w-full h-10 pl-9 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                  required
                />
                <User className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
              <span className="text-[10px] text-gray-400 mt-0.5 block">
                Chữ cái, số và dấu gạch dưới, từ 3-30 ký tự.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Địa chỉ Email *
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full h-10 pl-9 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                  required
                />
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Tên hiển thị (Biệt danh)
              </label>
              <input
                type="text"
                value={regDisplayName}
                onChange={(e) => setRegDisplayName(e.target.value)}
                placeholder="Hiển thị trên bình luận & hồ sơ"
                className="w-full h-10 px-3.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Mật khẩu *
                </label>
                <div className="relative">
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Ít nhất 6 ký tự"
                    className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    required
                  />
                  <KeyRound className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Xác nhận mật khẩu *
                </label>
                <input
                  type={showRegPassword ? 'text' : 'password'}
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu"
                  className="w-full h-10 px-3.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 mt-3 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Đăng Ký Tài Khoản
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <p className="text-xs text-gray-400">
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('login'); setErrorMsg(null); }}
                  className="text-brand-400 hover:text-brand-300 font-semibold ml-1"
                >
                  Đăng nhập ngay
                </button>
              </p>
            </div>
          </form>
        )}

        {/* TAB 3: DEMO ROLES QUICK LOGIN (Mỗi Role có >= 2 tài khoản) */}
        {activeTab === 'demo' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-brand-500/10 border border-brand-500/20 text-xs text-brand-300 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Đa dạng tài khoản theo Role (Mật khẩu chung: <code className="bg-brand-900/50 px-1 py-0.5 rounded text-white">password123</code>)</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Bấm <strong className="text-white">"Đăng nhập ngay"</strong> vào bất kỳ tài khoản nào bên dưới để trải nghiệm quyền hạn tương ứng.
                </p>
              </div>
            </div>

            {/* Role Filter Pills */}
            <div className="flex flex-wrap gap-1.5 pb-1">
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'admin', label: 'Admin (2 accs)' },
                { id: 'mod', label: 'Mod (3 accs)' },
                { id: 'translator', label: 'Translator (4 accs)' },
                { id: 'author', label: 'Tác giả (3 accs)' },
                { id: 'reader', label: 'Độc giả (4+ accs)' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setDemoRoleFilter(pill.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition ${
                    demoRoleFilter === pill.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Accounts Grid */}
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filteredDemoAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-brand-500/30 transition flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white text-xs font-bold ring-1 ring-white/20 flex-shrink-0 overflow-hidden">
                      {acc.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {acc.display_name || acc.username}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          @{acc.username}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        {acc.roles?.map((r: string) => (
                          <span
                            key={r}
                            className={`text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase ${getRoleBadgeClass(r)}`}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleQuickLogin(acc.username)}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow transition whitespace-nowrap group-hover:scale-105 flex-shrink-0"
                  >
                    Đăng nhập ngay
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}