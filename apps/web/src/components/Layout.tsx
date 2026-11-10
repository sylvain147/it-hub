import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ADMIN_LINKS, MENU_SECTIONS, MODULES, type MenuSection } from '../modules';
import { ROLE_LABELS } from '@samm/shared';
import { useAuth } from '../auth';
import { ToastHost } from './ui';
import { Brand } from './Brand';
import { SettingsProvider } from '../settings/context';
import { UsersProvider } from '../users/context';
import { FeedbackModal } from '../feedback/FeedbackModal';
import { ThemeModal } from '../users/ThemeModal';
import { BoutonRouge } from '../bouton/BoutonRouge';
import { TodoBadge } from '../tasks/TodoBadge';
import { Gandalf } from '../assistant/Gandalf';
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
          <Brand />
        </NavLink>
      </header>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <NavLink to="/" className="brand">
          <Brand />
        </NavLink>
        <SideNav />
        <UserMenu name={me.name} email={me.email} role={ROLE_LABELS[me.role]} admin={ADMIN_LINKS.filter((l) => !l.permission || me.permissions[l.permission])} onSignOut={() => void signOut()} />
      </aside>
      <main className="content" ref={contentRef}>
        <SettingsProvider>
          <UsersProvider>
            <MeetingRecorderProvider>
              <Outlet />
              <Gandalf />
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

const FOLDED_KEY = 'hub.menu.replie';

/** Menu par sections, repliables (choix retenu sur le poste) ; la section de la page affichée reste ouverte. */
function SideNav() {
  const { pathname } = useLocation();
  const [folded, setFolded] = useState<MenuSection[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as MenuSection[];
    } catch {
      return [];
    }
  });
  const toggle = (id: MenuSection) => {
    const next = folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id];
    localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    setFolded(next);
  };
  const isCurrent = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  // Depuis la page d'un projet, « Transcrire une réunion » présélectionne ce projet.
  const projectId = /^\/projets\/([^/]+)/.exec(pathname)?.[1];
  return (
    <nav className="side-nav">
      {MENU_SECTIONS.map((sec) => {
        const items = MODULES.filter((m) => m.section === sec.id && m.menu !== false);
        if (!items.length) return null;
        const current = items.some((m) => isCurrent(m.path));
        const open = current || !folded.includes(sec.id);
        return (
          <div key={sec.id} className="nav-section">
            <button className="nav-title" aria-expanded={open} onClick={() => toggle(sec.id)} disabled={current} title={current ? undefined : open ? 'Replier' : 'Déplier'}>
              <span>{sec.title}</span>
              {!current && <span className="nav-caret">{open ? '▾' : '▸'}</span>}
            </button>
            {open &&
              items.map((m) => (
                <NavLink key={m.id} to={m.id === 'reunion' && projectId ? `${m.path}?projet=${projectId}` : m.path} className="nav-link">
                  <span className="nav-icon">{m.icon}</span> {m.title}
                  {m.id === 'todo' && <TodoBadge />}
                </NavLink>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

/** Bas du menu : l'utilisateur ; un clic ouvre l'administration, le thème de couleur, « Faire un retour » et la déconnexion. */
function UserMenu({ name, email, role, admin, onSignOut }: { name: string; email: string; role: string; admin: typeof ADMIN_LINKS; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [theme, setTheme] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const inAdmin = admin.some((l) => pathname.startsWith(l.path));
  return (
    <div className="sidebar-foot">
      {open && <div className="user-menu-backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div className="user-menu" role="menu">
          {admin.map((l) => (
            <button key={l.path} role="menuitem" className={pathname.startsWith(l.path) ? 'active' : undefined} onClick={() => navigate(l.path)}>
              <span className="nav-icon">{l.icon}</span> {l.title}
            </button>
          ))}
          {admin.length > 0 && <hr />}
          <button role="menuitem" onClick={() => { setOpen(false); setTheme(true); }}>
            <span className="nav-icon">🎨</span> Thème de couleur
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); setFeedback(true); }}>
            <span className="nav-icon">💬</span> Faire un retour
          </button>
          <button role="menuitem" onClick={onSignOut}>
            <span className="nav-icon">↪</span> Se déconnecter
          </button>
        </div>
      )}
      <button className={`user-btn${inAdmin ? ' active' : ''}`} title={email} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="user-avatar">{name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span className="user-id">
          <strong>{name}</strong>
          <span className="small">{role}</span>
        </span>
        <span className="nav-caret">⚙️</span>
      </button>
      {feedback && <FeedbackModal onClose={() => setFeedback(false)} />}
      {theme && <ThemeModal onClose={() => setTheme(false)} />}
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
