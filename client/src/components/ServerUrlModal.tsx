// =============================================================
// ServerUrlModal — runtime server URL configuration
//
// Lets the user set the Docker host URL directly on the device.
// Changes are persisted to localStorage and take effect after
// the app reloads (window.location.reload()).
//
// Triggered from the error state in any view that fails to fetch.
// =============================================================

import { useState } from 'react'
import { X, WifiHigh, Check, Trash } from 'phosphor-react'
import { saveServerUrl, clearServerUrl, getConfiguredServerUrl } from '../lib/api'

interface ServerUrlModalProps {
  onClose: () => void
}

export function ServerUrlModal({ onClose }: ServerUrlModalProps) {
  const current = getConfiguredServerUrl()
  const [value, setValue] = useState(current)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    if (!value.trim()) return
    saveServerUrl(value.trim())
    setSaved(true)
    setTimeout(() => {
      onClose()
      // Reload so the new API_BASE is picked up
      window.location.reload()
    }, 700)
  }

  const handleClear = () => {
    clearServerUrl()
    onClose()
    window.location.reload()
  }

  const isChanged = value.trim() !== current

  return (
    /* Scrim */
    <div
      className="fixed inset-0 z-[9990] flex items-end"
      aria-modal="true"
      role="dialog"
      aria-label="Configure server URL"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-surface-900/70 backdrop-blur-sm"
      />

      {/* Sheet */}
      <div
        className="relative w-full animate-sheet_up"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-3 mb-3">
          <div className="server-modal-shell">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-bio-green/15 flex items-center justify-center">
                  <WifiHigh size={18} className="text-bio-green" weight="bold" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-surface-text">Server Connection</h2>
                  <p className="text-[11px] text-surface-muted">Set your Docker host address</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-surface-card flex items-center justify-center text-surface-muted hover:text-surface-text transition-colors"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Explainer */}
            <div className="rounded-2xl bg-bio-green/8 border border-bio-green/20 p-4 mb-4">
              <p className="text-[12px] leading-relaxed text-surface-text/80">
                Enter your PC's IP address where Docker is running. On <strong className="text-bio-green">local WiFi</strong>: find the IP under <code className="text-bio-green">Wi-Fi adapter</code> in <code className="text-bio-green">ipconfig</code>. On <strong className="text-bio-green">Tailscale</strong>: use <code className="text-bio-green">100.76.45.35</code>.
              </p>
            </div>

            {/* Input */}
            <label className="block text-[11px] font-medium text-surface-muted uppercase tracking-wider mb-1.5">
              Server URL
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="url"
                inputMode="url"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="http://192.168.1.10:3001"
                className="server-url-input flex-1"
              />
            </div>

            {/* Quick-fill hints */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {[
                { label: 'Tailscale', url: 'http://100.76.45.35:3001' },
                { label: 'VBox hint', url: 'http://192.168.56.1:3001' },
                { label: 'Localhost', url: 'http://localhost:3001' },
              ].map((hint) => (
                <button
                  key={hint.url}
                  type="button"
                  onClick={() => setValue(hint.url)}
                  className={
                    'px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors duration-200 ' +
                    (value === hint.url
                      ? 'bg-bio-green text-surface-900 border-bio-green'
                      : 'border-surface-border text-surface-muted hover:border-bio-green/50 hover:text-bio-green')
                  }
                >
                  {hint.label}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!isChanged && !value.trim()}
                className={
                  'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-[14px] transition-all duration-300 ' +
                  (saved
                    ? 'bg-bio-green text-surface-900'
                    : 'bg-bio-green text-surface-900 active:scale-[0.97]')
                }
              >
                {saved ? (
                  <>
                    <Check size={16} weight="bold" /> Saved — Reloading…
                  </>
                ) : (
                  <>
                    <Check size={16} weight="bold" /> Save & Reconnect
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleClear}
                title="Reset to default (Tailscale)"
                className="w-12 flex items-center justify-center rounded-2xl bg-surface-card text-surface-muted hover:text-red-400 transition-colors border border-surface-border"
              >
                <Trash size={16} weight="regular" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
