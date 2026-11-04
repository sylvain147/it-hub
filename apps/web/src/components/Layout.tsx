import { NavLink, Outlet } from 'react-router';
import { ADMIN_LINKS, MODULES } from '../modules';
import { signOutEverywhere, useAuth } from '../auth';
import { ToastHost } from './ui';

export function Layout() {
  const { email, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
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
          {ADMIN_LINKS.map((l) => (
            <NavLink key={l.path} to={l.path} className="nav-link">
              <span className="nav-icon">{l.icon}</span> {l.title}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user" title={email}>{email}</div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await signOutEverywhere();
              signOut();
            }}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
