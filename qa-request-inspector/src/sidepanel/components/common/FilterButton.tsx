interface FilterButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
  isError?: boolean
}

export function FilterButton({
  active,
  onClick,
  children,
  count,
  isError,
}: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      // Labels never wrap: in an `@container` filter bar the padding and font
      // shrink with its width, past that the buttons move to a second row.
      className={`flex-auto whitespace-nowrap py-1.5 px-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 @max-[420px]:px-1.5 @max-[420px]:gap-1 @max-[360px]:text-[11px] ${
        active
          ? 'bg-accent text-white'
          : 'text-text-muted hover:text-text hover:bg-hover'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
          active
            ? 'bg-white/20'
            : isError
              ? 'bg-red-100 text-red-600'
              : 'bg-hover'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}
