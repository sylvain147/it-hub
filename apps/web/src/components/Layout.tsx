import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ADMIN_LINKS, MODULES } from '../modules';
import { ROLE_LABELS } from '@samm/shared';
import { useAuth } from '../auth';
import { ToastHost } from './ui';
import { SettingsProvider } from '../settings/context';
import { UsersProvider } from '../users/context';
import { FeedbackButton } from '../feedback/FeedbackButton';
import { BoutonRouge } from '../bouton/BoutonRouge';
import { TodoButton } from '../tasks/TodoButton';
import { MeetingRecorderProvider, RecordingPill } from '../meetings/recorder';

export function Layout() {
  const { me, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);

  // Le menu mobile se referme à chaque navigation.
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useResponsiveTables(contentRef);

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button className="burger" aria-label="Ouvrir le menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        <NavLink to="/" className="brand brand-mobile">
          <span className="brand-logo">IT</span>
          <span>Hub IT</span>
        </NavLink>
      </header>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <NavLink to="/" className="brand">
          <span className="brand-logo">IT</span>
          <span>Hub IT</span>
        </NavLink>
        <nav>
          <div className="nav-title">Modules</div>
          {MODULES.map((m) => (
            <NavLink key={m.id} to={m.path} className="nav-link">
              <span className="nav-icon">{m.icon}</span> {m.title}
            </NavLink>
          ))}
          <div className="nav-title">Pilotage</div>
          {ADMIN_LINKS.filter((l) => !l.permission || me.permissions[l.permission]).map((l) => (
            <NavLink key={l.path} to={l.path} className="nav-link">
              <span className="nav-icon">{l.icon}</span> {l.title}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <FeedbackButton />
          <div className="user" title={me.email}>
            <strong>{me.name}</strong>
            <div className="small">{ROLE_LABELS[me.role]}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="content" ref={contentRef}>
        <SettingsProvider>
          <UsersProvider>
            <MeetingRecorderProvider>
              <Outlet />
              <TodoButton />
              <RecordingPill />
              <BoutonRouge />
            </MeetingRecorderProvider>
          </UsersProvider>
        </SettingsProvider>
      </main>
      <ToastHost />
    </div>
  );
}

/**
 * Sur petit écran, les tableaux s'affichent en cartes (voir styles.css) : chaque cellule reçoit
 * le libellé de sa colonne (`data-label`). Un observateur suffit à couvrir tous les écrans du hub.
 */
function useResponsiveTables(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const label = () => {
      frame = 0;
      root.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach((table) => {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        table.querySelectorAll('tbody tr').forEach((tr) => {
          [...tr.children].forEach((td, i) => {
            const l = heads[i] ?? '';
            if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
          });
        });
      });
    };
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(label);
    });
    observer.observe(root, { childList: true, subtree: true });
    label();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}
