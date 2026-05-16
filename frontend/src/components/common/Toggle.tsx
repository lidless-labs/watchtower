interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  /** Optional override for the accessible name when `label` doubles as a longer string. */
  ariaLabel?: string
}

/**
 * Keyboard-accessible switch built on a native button so Space/Enter and
 * Tab navigation work without extra wiring. Visually a pill toggle that
 * matches the existing Settings palette.
 *
 * Replaces the raw-div onClick toggles scattered across SpeedtestTab,
 * IntegrationsTab, and elsewhere, which were not focusable or operable
 * with assistive tech.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  ariaLabel,
}: ToggleProps) {
  const toggle = () => {
    if (!disabled) onChange(!checked)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={toggle}
      className={`group flex items-center gap-2 text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked
            ? 'bg-accent-cyan'
            : 'bg-bg-tertiary border border-border-default'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        {description && (
          <span className="text-xs text-text-secondary">{description}</span>
        )}
      </span>
    </button>
  )
}
