import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  Folder01Icon,
  Task01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { useSessionActions } from "../../auth/session-context";
import type { UserDto } from "../../auth/identity";
import styles from "../workspace.module.css";
const nav = [
  { to: "/", label: "Overview", icon: DashboardSquare01Icon },
  { to: "/projects", label: "Projects", icon: Folder01Icon },
  { to: "/tasks", label: "Tasks", icon: Task01Icon },
  { to: "/settings", label: "Settings", icon: RefreshIcon },
];
function SignOut() {
  const actions = useSessionActions();
  return (
    <Button
      variant="outline"
      size="sm"
      isDisabled={!actions}
      onPress={() => {
        if (actions?.canAct()) void actions.signOut();
      }}
    >
      Sign out
    </Button>
  );
}
export function WorkspaceShell({
  children,
  user,
}: {
  children: ReactNode;
  user: UserDto;
}) {
  const location = useLocation();
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <span>W</span> Workbench
        </Link>
        <nav aria-label="Workspace">
          <ul>
            {nav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={
                    location.pathname === item.to ? styles.active : undefined
                  }
                >
                  <HugeiconsIcon icon={item.icon} size={18} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.sidebarNote}>
          <p>{user.email}</p>
          <SignOut />
        </div>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.mobileHeader}>
          <Link to="/" className={styles.brand}>
            <span>W</span> Workbench
          </Link>
          <nav aria-label="Mobile workspace">
            {nav.map((item) => (
              <Link key={item.to} to={item.to} aria-label={item.label}>
                <HugeiconsIcon icon={item.icon} size={20} />
              </Link>
            ))}
          </nav>
          <SignOut />
        </header>
        <div className={styles.banner}>
          Projects and tasks are saved to your account in PostgreSQL. Legacy
          browser data is never imported or removed automatically.
        </div>
        <main id="content" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
export function NotFound() {
  return (
    <main className={styles.notFound}>
      <p className={styles.eyebrow}>404</p>
      <h1>That page is not in this workspace.</h1>
      <p>Use the overview to find your way back.</p>
      <Link className={buttonVariants()} to="/">
        Go to overview
      </Link>
    </main>
  );
}
export function RouteError({ error }: { error: Error }) {
  return (
    <main className={styles.notFound}>
      <p className={styles.eyebrow}>Something went wrong</p>
      <h1>We could not open this view.</h1>
      <p>{error.message}</p>
      <Link className={buttonVariants()} to="/">
        Return to overview
      </Link>
    </main>
  );
}
