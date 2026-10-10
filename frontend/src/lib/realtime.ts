'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { refreshSession } from './session';

/**
 * One shared Socket.IO connection for the signed-in user (opened/closed by AuthContext).
 * The server only sends "something changed" pings (`notification`, `dm`, `group_message`);
 * pages react by refetching. Pages keep a slow polling fallback for when the socket is down.
 */

type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();
let socket: Socket | null = null;

/** Open the socket; the handshake goes through the gateway with the session cookie (no token in JS). */
export function connectRealtime() {
  if (socket) return;
  let retried = false;
  socket = io({ path: '/socket.io', transports: ['websocket'], withCredentials: true });
  socket.onAny((event: string, data: any) => listeners.get(event)?.forEach((fn) => fn(data)));
  // Refused at the handshake: usually the 15-minute access cookie ran out. Refresh once, then reconnect.
  socket.on('connect_error', async () => {
    if (retried || !socket) return;
    retried = true;
    if (await refreshSession()) setTimeout(() => socket?.connect(), 500);
  });
  socket.on('connect', () => { retried = false; });
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

/** Calls the latest `handler` whenever the server pushes `event`. */
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
