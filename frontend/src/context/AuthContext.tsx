'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { connectRealtime, disconnectRealtime } from '@/lib/realtime';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export interface UserRoleInfo {
  role: string;
  is_visible?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
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
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  authModalTab: 'login' | 'register';
  openAuthModal: (tab?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  login: (identifier: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (data: { username: string; email: string; password: string; display_name?: string }) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  refreshProfile: () => Promise<void>;
  /** Replace the stored token (the server issues a new one after a password change). */
  setSessionToken: (token: string) => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');

  const openAuthModal = (tab: 'login' | 'register' = 'login') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
  };

  // Helper to fetch with Bearer token & cookie credentials
  const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const currentToken = token || (typeof window !== 'undefined' ? localStorage.getItem('novelhub_token') : null);
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    if (currentToken && currentToken !== 'cookie_session') {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    return fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });
  };

  const setSessionToken = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem('novelhub_token', newToken);
  };

  // Forget the local session (token + cached user). Used when the server rejects it.
  const clearLocalSession = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('novelhub_token');
      localStorage.removeItem('novelhub_user');
    }
    setToken(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    const savedToken = token || (typeof window !== 'undefined' ? localStorage.getItem('novelhub_token') : null);

    try {
      const headers: Record<string, string> = {};
      if (savedToken) {
        headers['Authorization'] = `Bearer ${savedToken}`;
      }

      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers,
        credentials: 'include',
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setUser(json.data);
          if (typeof window !== 'undefined') {
            localStorage.setItem('novelhub_user', JSON.stringify(json.data));
          }
          return;
        }
      }
      // Token/cookie expired, invalid, or account banned. A 5xx or network error keeps the session.
      if (res.status === 401 || res.status === 403) clearLocalSession();
    } catch (e) {
      console.error('Failed to verify token:', e);
    }
  };

  // Initialize auth on client mount (Check localStorage and cookie session)
  useEffect(() => {
    const initAuth = async () => {
      try {
        const savedToken = localStorage.getItem('novelhub_token');
        const savedUser = localStorage.getItem('novelhub_user');

        if (savedToken) {
          setToken(savedToken);
        }
        if (savedUser) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            // ignore
          }
        }

        // Always check /auth/me with credentials: 'include' to support 30-day cookie
        const headers: Record<string, string> = {};
        if (savedToken) {
          headers['Authorization'] = `Bearer ${savedToken}`;
        }

        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers,
          credentials: 'include',
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setUser(json.data);
            localStorage.setItem('novelhub_user', JSON.stringify(json.data));
            if (!savedToken && json.data.id) {
              // Cookie is active!
              setToken('cookie_session');
            }
          } else {
            clearLocalSession();
          }
        } else if (res.status === 401 || res.status === 403 || !savedToken) {
          // Saved token expired/invalid (or none at all): don't keep showing a stale signed-in user
          clearLocalSession();
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (identifier: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, message: json.message || 'Đăng nhập thất bại' };
      }

      const { token: receivedToken, user: receivedUser } = json.data;
      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem('novelhub_token', receivedToken);
      localStorage.setItem('novelhub_user', JSON.stringify(receivedUser));

      closeAuthModal();
      return { success: true, message: json.message };
    } catch (err: any) {
      return { success: false, message: 'Lỗi kết nối mạng: ' + err.message };
    }
  };

  const register = async (data: { username: string; email: string; password: string; display_name?: string }): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, message: json.message || 'Đăng ký thất bại' };
      }

      const { token: receivedToken, user: receivedUser } = json.data;
      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem('novelhub_token', receivedToken);
      localStorage.setItem('novelhub_user', JSON.stringify(receivedUser));

      closeAuthModal();
      return { success: true, message: json.message };
    } catch (err: any) {
      return { success: false, message: 'Lỗi kết nối mạng: ' + err.message };
    }
  };

  const logout = () => {
    try {
      fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
    } catch {
      // ignore
    }
    localStorage.removeItem('novelhub_token');
    localStorage.removeItem('novelhub_user');
    setToken(null);
    setUser(null);
  };

  // Realtime pushes only for signed-in users
  useEffect(() => {
    if (user) connectRealtime(token);
    else disconnectRealtime();
  }, [user?.id, token]);

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
        token,
        isLoading,
        isAuthenticated: !!user,
        isAuthModalOpen,
        authModalTab,
        openAuthModal,
        closeAuthModal,
        login,
        register,
        logout,
        authFetch,
        refreshProfile,
        setSessionToken,
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
