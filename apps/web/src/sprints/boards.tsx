import { useEffect, useState } from 'react';
import { DEFAULT_BOARD_ID, type Board } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * Tableaux de tickets, chargés une fois et partagés par les pages (page Tickets, fiche d'un ticket, paramétrage, fiche
 * utilisateur) ; rechargés quand un tableau change (`boardsChanged`).
 */

const CHANGED = 'hobbit:tableaux';
let cache: Promise<Board[]> | null = null;

function load(): Promise<Board[]> {
  cache ??= api.boards().catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

/** À appeler après la création, le renommage, la suppression d'un tableau ou le changement de ses règles. */
export function boardsChanged() {
  cache = null;
  window.dispatchEvent(new Event(CHANGED));
}

/** Tableaux (le principal d'abord) ; null pendant le chargement. */
export function useBoards(): Board[] | null {
  const [boards, setBoards] = useState<Board[] | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void load().then((b) => alive && setBoards(b), () => alive && setBoards([]));
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, refresh);
    };
  }, []);
  return boards;
}

/** Mon tableau par défaut (choisi sur ma fiche), s'il existe encore ; sinon le tableau principal. */
export function useDefaultBoardId(boards: Board[] | null): string {
  const { me } = useAuth();
  return me.defaultBoardId && boards?.some((b) => b.id === me.defaultBoardId) ? me.defaultBoardId : DEFAULT_BOARD_ID;
}

/** Nom d'un tableau, pour préciser un sprint quand il y a plusieurs tableaux (« Support · Sprint 3 »). */
export function boardPrefix(boards: Board[] | null, boardId: string): string {
  if (!boards || boards.length < 2) return '';
  return `${boards.find((b) => b.id === boardId)?.name ?? 'Tableau supprimé'} · `;
}
