import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  secondary: 'bg-surface border border-border text-text hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-white hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  ),
);

export const IconButton = ({ label, className, ...props }: ButtonProps & { label: string }) => (
  <Button variant="ghost" size="sm" aria-label={label} title={label} className={clsx('!px-2', className)} {...props} />
);

// ---------------------------------------------------------------- form controls

const control =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={clsx(control, 'h-10', className)} {...props} />
));

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={clsx(control, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  ),
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={clsx(control, 'min-h-20 py-2', className)} {...props} />,
);

export const MoneyInput = (props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) => (
  <Input type="number" inputMode="decimal" step="0.01" min="0" className="tabular text-right" {...props} />
);

/** Label + control + hint. The control receives the generated id through the render prop. */
export const Field = ({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}) => {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
};

export const Checkbox = ({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
    <input type="checkbox" className="size-4 accent-[var(--primary)]" {...props} />
    {label}
  </label>
);

/** Segmented control. */
export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) => (
  <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={clsx(
          'rounded-md font-medium transition-colors',
          size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
          value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

// ---------------------------------------------------------------- layout

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={clsx('rounded-xl border border-border bg-surface', className)}>{children}</section>
);

export const CardHeader = ({ title, actions, subtitle }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
    <div>
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const Badge = ({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'warning';
  children: ReactNode;
}) => (
  <span
    className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
      'bg-surface-2 text-muted': tone === 'neutral',
      'bg-primary-soft text-primary': tone === 'primary',
      'bg-success-soft text-success': tone === 'success',
      'bg-danger-soft text-danger': tone === 'danger',
      'bg-warning-soft text-warning': tone === 'warning',
    })}
  >
    {children}
  </span>
);

export const Spinner = ({ label = 'Cargando…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
    <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
  </div>
);

export const EmptyState = ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
    <p className="font-medium">{title}</p>
    {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export const ErrorBanner = ({ error }: { error: unknown }) =>
  error ? (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {error instanceof Error ? error.message : 'Ocurrió un error'}
    </div>
  ) : null;

export const Notice = ({ tone = 'warning', children }: { tone?: 'warning' | 'primary'; children: ReactNode }) => (
  <div
    className={clsx(
      'rounded-lg px-3 py-2 text-sm',
      tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary',
    )}
  >
    {children}
  </div>
);

export const ProgressBar = ({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'success' | 'danger' | 'warning' }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div
      className={clsx('h-full rounded-full', {
        'bg-primary': tone === 'primary',
        'bg-success': tone === 'success',
        'bg-danger': tone === 'danger',
        'bg-warning': tone === 'warning',
      })}
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

// ---------------------------------------------------------------- modal

export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx(
        'm-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-text shadow-xl',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="font-semibold">{title}</h2>
            <IconButton label="Cerrar" onClick={onClose} icon={<X className="size-4" />} />
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
};

// ---------------------------------------------------------------- table

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm">{children}</table>
  </div>
);

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('border-b border-border px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted', className)}>
    {children}
  </th>
);

export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={clsx('border-b border-border px-4 py-2.5 align-middle', className)}>
    {children}
  </td>
);
