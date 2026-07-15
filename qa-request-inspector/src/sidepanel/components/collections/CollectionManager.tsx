import { Bookmark, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { RequestCollection } from '../../types'
import { t } from '../../locales'

interface CollectionManagerProps {
  collections: RequestCollection[]
  onCreate: (name: string, description?: string, color?: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const COLLECTION_COLORS = [
  '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED',
  '#DB2777', '#0891B2', '#65A30D',
]

export function CollectionManager({
  collections,
  onCreate,
  onDelete,
  onClose,
}: CollectionManagerProps) {
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0])

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newDescription.trim() || undefined, newColor)
    setNewName('')
    setNewDescription('')
    setNewColor(COLLECTION_COLORS[0])
  }, [newName, newDescription, newColor, onCreate])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-[var(--color-accent)]" />
          <h2 className="text-sm font-semibold">{t().collections}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--color-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {/* Create new collection */}
        <div className="space-y-2 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t().collectionName}
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder={t().collectionDescription}
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">{t().collectionColor}:</span>
            <div className="flex gap-1">
              {COLLECTION_COLORS.map(color => (
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
            {t().createCollection}
          </button>
        </div>

        {/* Collection list */}
        {collections.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)]">
            <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">{t().noCollections}</p>
          </div>
        ) : (
          collections.map(collection => (
            <div
              key={collection.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: collection.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{collection.name}</p>
                {collection.description && (
                  <p className="text-[10px] text-[var(--color-text-muted)] truncate">{collection.description}</p>
                )}
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {collection.requestIds.length} {t().requests}
                </p>
              </div>
              <button
                onClick={() => onDelete(collection.id)}
                className="p-1 rounded text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors"
                title={t().deleteCollection}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}