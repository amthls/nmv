'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * One shared Socket.IO connection for the signed-in user (opened/closed by AuthContext).
 * The server only sends "something changed" pings (`notification`, `dm`, `group_message`);
 * pages react by refetching. Pages keep a slow polling fallback for when the socket is down.
 */

type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();
let socket: Socket | null = null;
let socketToken: string | null = null;

export function connectRealtime(token: string | null) {
  if (socket && socketToken === token) return;
  disconnectRealtime();
  socketToken = token;
  socket = io({
    path: '/socket.io',
    transports: ['websocket'],
    auth: token ? { token } : {}, // the httpOnly cookie is sent too
    withCredentials: true,
  });
  socket.onAny((event: string, data: any) => listeners.get(event)?.forEach((fn) => fn(data)));
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
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
