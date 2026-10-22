import { useEffect, useId, useRef, type ReactNode } from "react";

export type IconName =
  | "dashboard"
  | "folder"
  | "users"
  | "plus"
  | "search"
  | "edit"
  | "archive"
  | "arrow"
  | "back"
  | "close"
  | "settings"
  | "refresh"
  | "check"
  | "activity"
  | "message"
  | "ticket";

const paths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  edit: (
    <>
      <path d="m15 5 4 4M4 16 16 4a2.8 2.8 0 0 1 4 4L8 20H4Z" />
    </>
  ),
  archive: (
    <>
      <path d="M4 8v12h16V8M3 4h18v4H3ZM9 12h6" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z" />
      <circle cx="12" cy="11" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
  message: <path d="M4 4h16v13H9l-5 4Z" />,
  ticket: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8m-8 4h8m-8 4h5" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "accent" | "muted";
}) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "La requête n’a pas pu aboutir.";
}

export function formText(form: HTMLFormElement, name: string) {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function EmptyState({
  icon = "folder",
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name={icon} size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-line" />
      <span className="loading-line loading-line-short" />
      <p>{label}</p>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className="page-header">
      <div>
        <h1 ref={ref} tabIndex={-1}>
          {title}
        </h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="table-footer">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} sur ${total}`
          : "0 résultat"}
      </span>
      <div>
        <button
          type="button"
          className="pagination-button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Page précédente"
        >
          <Icon name="back" size={16} />
        </button>
        <span>
          Page {page} / {lastPage}
        </span>
        <button
          type="button"
          className="pagination-button"
          disabled={page >= lastPage}
          onClick={() => onChange(page + 1)}
          aria-label="Page suivante"
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Fermer la fenêtre"
          onClick={onClose}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ArchiveDialog({
  name,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Confirmer l’archivage" onClose={onClose} busy={busy}>
      <div className="modal-body">
        <span className="archive-symbol">
          <Icon name="archive" size={28} />
        </span>
        <p>
          Archiver <strong>{name}</strong> ?
        </p>
        <p className="muted-copy">
          L’historique sera conservé. Les nouvelles affectations et exécutions ne seront
          plus autorisées.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          Annuler
        </button>
        <button
          className="danger-button"
          type="button"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Archivage…" : "Archiver"}
        </button>
      </div>
    </Modal>
  );
}
