import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ADMIN_LINKS, MENU_SECTIONS, MODULES, TOOL_MODULES, type MenuSection } from '../modules';
import { ROLE_LABELS, toolsOrDefault } from '@samm/shared';
import { useAuth } from '../auth';
import { ToastHost } from './ui';
import { Brand } from './Brand';
import { SettingsProvider } from '../settings/context';
import { UsersProvider } from '../users/context';
import { FeedbackModal } from '../feedback/FeedbackModal';
import { ThemeModal } from '../users/ThemeModal';
import { AnneauFlottant, AnneauProvider, ringClass, useRingHolder } from '../anneau/Anneau';
import { TodoBadge } from '../tasks/TodoBadge';
import { Gandalf } from '../assistant/Gandalf';
import { ProcessNextDialog } from '../projects/ProcessNextDialog';
import { AiRecapDialog } from '../assistant/AiRecap';
import { NazgulEffects } from './NazgulEffects';
import { MeetingRecorderProvider, RecordingPill } from '../meetings/recorder';
import { hasUnreadPatchNote } from '../patchnotes/PatchNotePage';

export function Layout() {
  const { me, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);

  // Le menu mobile se referme à chaque navigation.
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useResponsiveTables(contentRef);

  return (
    <AnneauProvider>
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
                <ProcessNextDialog />
                <AiRecapDialog />
                <RecordingPill />
                <AnneauFlottant />
              </MeetingRecorderProvider>
            </UsersProvider>
          </SettingsProvider>
        </main>
        <ToastHost />
        <NazgulEffects />
      </div>
    </AnneauProvider>
  );
}

const FOLDED_KEY = 'hub.menu.replie';

/** Menu par sections, repliables (choix retenu sur le poste) ; la section de la page affichée reste ouverte. */
function SideNav() {
  const { pathname } = useLocation();
  const { me } = useAuth();
  const tools = toolsOrDefault(me.tools, TOOL_MODULES.map((m) => m.id));
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
  return (
    <nav className="side-nav">
      {MENU_SECTIONS.map((sec) => {
        // Section « Outils » : les outils choisis sur sa fiche, dans son ordre, puis ses liens.
        const items =
          sec.id === 'outils'
            ? tools.modules.flatMap((id) => TOOL_MODULES.filter((m) => m.id === id))
            : MODULES.filter((m) => m.section === sec.id && m.menu !== false);
        if (!items.length && sec.id !== 'outils') return null;
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
                <NavLink key={m.id} to={m.path} className="nav-link">
                  <span className="nav-icon">{m.icon}</span> {m.title}
                  {m.id === 'todo' && <TodoBadge />}
                </NavLink>
              ))}
            {open &&
              sec.id === 'outils' &&
              tools.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="nav-link" title={l.url}>
                  <span className="nav-icon">{l.icon || '🔗'}</span> {l.label} <span className="nav-ext">↗</span>
                </a>
              ))}
            {open && sec.id === 'outils' && !items.length && !tools.links.length && (
              <NavLink to="/moi?onglet=outils" className="nav-link nav-link-muted">
                <span className="nav-icon">＋</span> Choisir mes outils
              </NavLink>
            )}
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
  const ring = ringClass(useRingHolder(), email);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  // Recalculé à chaque navigation et ouverture du menu : la visite du patch note efface la pastille.
  const unread = useMemo(() => hasUnreadPatchNote(), [pathname, open]);
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
          <button role="menuitem" className={pathname === '/moi' ? 'active' : undefined} onClick={() => navigate('/moi')}>
            <span className="nav-icon">🪪</span> Ma fiche
          </button>
          <button role="menuitem" className={pathname === '/patch-note' ? 'active' : undefined} onClick={() => navigate('/patch-note')}>
            <span className="nav-icon">📰</span> Patch note {unread && <span className="badge badge-warn">Nouveau</span>}
          </button>
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
        <span className={`user-avatar${ring}`}>{name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span className="user-id">
          <strong>{name}</strong>
          <span className="small">{role}</span>
        </span>
        <span className="nav-caret">{unread && <span className="dot-new" title="Nouvelle mise à jour : voir le patch note" />}⚙️</span>
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
