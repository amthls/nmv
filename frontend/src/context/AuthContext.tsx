'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { connectRealtime, disconnectRealtime } from '@/lib/realtime';
import { apiFetch, IDENTITY_URL } from '@/lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export interface UserRoleInfo {
  role: string;
  is_visible?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  email_verified?: boolean;
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
  bio?: string;
  roles?: (string | UserRoleInfo)[];
  settings?: any;
  stats?: {
    stories_read: number;
    favorites_count: number;
    bookmarks_count: number;
    posts_count: number;
    comments_count: number;
    groups_count: number;
  };
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  authModalTab: 'login' | 'register';
  openAuthModal: (tab?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  login: (identifier: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (data: { username: string; email: string; password: string; display_name?: string; turnstile_token?: string }) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  /** fetch with the session cookies, the CSRF header on writes and a refresh-and-retry on 401 */
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Only what draws the header before /me answers; never the email (localStorage is readable by any script)
const CACHE_KEY = 'novelhub_user';
const cacheUser = (u: UserProfile | null) => {
  try {
    if (!u) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url, roles: u.roles }));
  } catch {}
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');

  const openAuthModal = (tab: 'login' | 'register' = 'login') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
  };
  const closeAuthModal = () => setIsAuthModalOpen(false);

  const clearLocalSession = () => {
    cacheUser(null);
    setUser(null);
  };

  /**
   * Who am I: account facts from identity (email, verified) + profile from the backend (name, avatar, visible roles).
   * 401 = signed out (after a refresh attempt). A 5xx or network error keeps what we have.
   */
  const refreshProfile = async () => {
    try {
      const idRes = await apiFetch(`${IDENTITY_URL}/me`);
      if (idRes.status === 401 || idRes.status === 403) return clearLocalSession();
      if (!idRes.ok) return;
      const account = (await idRes.json()).data;
      const profRes = await apiFetch(`${API_BASE_URL}/auth/me`);
      const profile = profRes.ok ? (await profRes.json()).data : null;
      const merged: UserProfile = { ...account, ...(profile || {}), email: account.email, email_verified: account.email_verified };
      setUser(merged);
      cacheUser(merged);
    } catch (e) {
      console.error('Failed to load the session:', e);
    }
  };

  useEffect(() => {
    try {
      localStorage.removeItem('novelhub_token'); // left over from the old JWT-in-localStorage sign-in
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setUser(JSON.parse(cached));
    } catch {}
    refreshProfile().finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (path: string, body: unknown, fallback: string) => {
    try {
      const res = await apiFetch(`${IDENTITY_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) return { success: false, message: json.message || fallback };
      await refreshProfile();
      closeAuthModal();
      return { success: true, message: json.message };
    } catch (err: any) {
      return { success: false, message: 'Lỗi kết nối mạng: ' + err.message };
    }
  };

  const login = (identifier: string, password: string) => submit('/login', { identifier, password }, 'Đăng nhập thất bại');
  const register = (data: { username: string; email: string; password: string; display_name?: string; turnstile_token?: string }) =>
    submit('/register', data, 'Đăng ký thất bại');

  const logout = () => {
    apiFetch(`${IDENTITY_URL}/logout`, { method: 'POST' }).catch(() => {});
    clearLocalSession();
  };

  // Realtime pushes only for signed-in users (the socket handshake carries the session cookie)
  useEffect(() => {
    if (user) connectRealtime();
    else disconnectRealtime();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasRole = (...roles: string[]): boolean => {
    if (!user || !user.roles) return false;
    const userRoles = user.roles.map((r: any) => (typeof r === 'string' ? r : r.role));
    if (userRoles.includes('admin')) return true;
    return roles.some((r) => userRoles.includes(r));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAuthModalOpen,
        authModalTab,
        openAuthModal,
        closeAuthModal,
        login,
        register,
        logout,
        authFetch: apiFetch,
        refreshProfile,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
