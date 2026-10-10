'use client';

import { useEffect, useRef } from 'react';
import { refreshSession } from './session';

/**
 * One shared WebSocket to the messaging service for the signed-in user (opened/closed by AuthContext).
 * The server only sends "something changed" pings `{type, data}` (`notification`, `dm`, `group_message`);
 * pages react by refetching. Nothing is replayed after a reconnect: every listener is called once instead,
 * so pages refetch what they may have missed (the database is the truth, the socket only says "look again").
 */

type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();
const HIDDEN_CLOSE_MS = 5 * 60_000; // a tab hidden this long lets its socket go (reopened when shown)

let socket: WebSocket | null = null;
let wanted = false; // signed in: keep a socket open
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let refreshed = false;

// One id per browser tab, so a reconnect replaces this tab's old socket on the server instead of adding one
function tabId() {
  try {
    let id = sessionStorage.getItem('rt_tab');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('rt_tab', id);
    }
    return id;
  } catch {
    return '';
  }
}

const emit = (type: string, data: any) => listeners.get(type)?.forEach((fn) => fn(data));

function open() {
  if (!wanted || socket || typeof window === 'undefined') return;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${window.location.host}/api/msg/ws?tab=${tabId()}`);
  socket = ws;
  let opened = false;
  ws.onopen = () => {
    opened = true;
    refreshed = false;
    if (attempt > 0) listeners.forEach((_, type) => emit(type, {})); // catch up on whatever happened while away
    attempt = 0;
  };
  ws.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data);
      if (typeof type === 'string') emit(type, data ?? {});
    } catch {}
  };
  ws.onclose = async (e) => {
    if (socket === ws) socket = null;
    if (!wanted || e.code === 4000 || e.code === 4003) return; // replaced by this tab's newer socket / signed out
    // Refused before opening: usually the 15-minute access cookie ran out. Refresh it once, then retry.
    if (!opened && !refreshed) {
      refreshed = true;
      if (await refreshSession()) attempt = 0;
    }
    attempt++;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (0.5 + Math.random()); // random backoff: no stampede after a restart
    retryTimer = setTimeout(open, delay);
  };
}

function onVisibility() {
  if (document.hidden) {
    hiddenTimer = setTimeout(() => socket?.close(1000, 'hidden'), HIDDEN_CLOSE_MS);
  } else {
    if (hiddenTimer) clearTimeout(hiddenTimer);
    if (!socket && wanted) {
      attempt = 1; // counts as a reconnect: listeners refetch
      open();
    }
  }
}

/** Open the socket; the upgrade goes through the gateway with the session cookie (no token in JS). */
export function connectRealtime() {
  if (wanted) return;
  wanted = true;
  attempt = 0;
  document.addEventListener('visibilitychange', onVisibility);
  open();
}

export function disconnectRealtime() {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisibility);
  if (retryTimer) clearTimeout(retryTimer);
  if (hiddenTimer) clearTimeout(hiddenTimer);
  socket?.close(1000, 'signed out');
  socket = null;
}

/** Calls the latest `handler` whenever the server pushes `event` (and once after each reconnect). */
export function useRealtime(event: string, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn: Handler = (data) => ref.current(data);
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return () => {
      listeners.get(event)?.delete(fn);
    };
  }, [event]);
}
