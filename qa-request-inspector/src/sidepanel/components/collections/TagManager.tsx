import { Plus, Tag, Trash2, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { RequestTag } from '../../types'
import { t } from '../../locales'

interface TagManagerProps {
  tags: RequestTag[]
  onCreate: (name: string, color: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const TAG_COLORS = [
  '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED',
  '#DB2777', '#0891B2', '#65A30D', '#E11D48', '#0D9488',
]

export function TagManager({
  tags,
  onCreate,
  onDelete,
  onClose,
}: TagManagerProps) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newColor)
    setNewName('')
    setNewColor(TAG_COLORS[0])
  }, [newName, newColor, onCreate])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-[var(--color-accent)]" />
          <h2 className="text-sm font-semibold">{t().tags}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--color-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {/* Create new tag */}
        <div className="space-y-2 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t().tagName}
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">{t().tagColor}:</span>
            <div className="flex gap-1 flex-wrap">
              {TAG_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    newColor === color ? 'scale-125 ring-1 ring-offset-1 ring-[var(--color-accent)]' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-accent)] text-white rounded hover:opacity-90 disabled:opacity-30 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t().addTag}
          </button>
        </div>

        {/* Tag list */}
        {tags.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)]">
            <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">{t().noTags}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <div
                key={tag.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                <Tag className="w-3 h-3" />
                {tag.name}
                <button
                  onClick={() => onDelete(tag.id)}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors"
                  title={t().deleteTag}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}