import { useState } from 'react'
import { t } from '../../locales'
import { decodeFormBody, encodeFormBody, isFormEncoded } from '../../utils/formBody'

interface BodyEditorProps {
  /** The body as it will be sent (still encoded for a form). */
  value: string
  onChange: (value: string) => void
  /** Content-Type of the request, used to offer the decoded form view. */
  contentType?: string
  className?: string
  placeholder?: string
}

/**
 * Request body textarea. A form-encoded body ("name=1&prompt=%D0%BF...") can be switched to a
 * decoded view, one "name=value" line per field; every edit there is encoded back, so `value` is
 * always ready to send.
 */
export function BodyEditor({ value, onChange, contentType, className, placeholder }: BodyEditorProps) {
  // Decoded text and the body it was decoded from: while the text is not edited, that exact body is
  // kept, so merely switching views never changes how the request is encoded.
  // `sent` is the last body handed to onChange: any other value was set from outside (a negative
  // test filled the body), and the decoded text is rebuilt from it.
  const [form, setForm] = useState<{ text: string; source: string; sent: string } | null>(null)
  if (form && value !== form.sent) setForm({ text: decodeFormBody(value), source: value, sent: value })
  const canDecode = form !== null || isFormEncoded(value, contentType)

  const showForm = () => setForm({ text: decodeFormBody(value), source: value, sent: value })
  const showText = () => setForm(null)

  const editForm = (text: string) => {
    if (!form) return
    const sent = text === decodeFormBody(form.source) ? form.source : encodeFormBody(text, form.source.includes('+'))
    setForm({ ...form, text, sent })
    onChange(sent)
  }

  const tab = (active: boolean) =>
    `px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${active ? 'bg-accent text-white' : 'text-text-muted hover:bg-hover'}`

  return (
    <div>
      {canDecode && (
        <div className="mb-1 flex items-center gap-1" role="group" aria-label={t().bodyViewLabel}>
          <button type="button" onClick={showText} className={tab(form === null)} aria-pressed={form === null}>
            {t().bodyViewRaw}
          </button>
          <button type="button" onClick={showForm} className={tab(form !== null)} aria-pressed={form !== null}>
            {t().bodyViewForm}
          </button>
        </div>
      )}
      <textarea
        value={form ? form.text : value}
        onChange={(event) => (form ? editForm(event.target.value) : onChange(event.target.value))}
        spellCheck={false}
        className={className}
        placeholder={form ? 'name=value' : placeholder}
      />
      {form && <p className="mt-1 text-[10px] text-text-muted">{t().bodyViewFormHint}</p>}
    </div>
  )
}
