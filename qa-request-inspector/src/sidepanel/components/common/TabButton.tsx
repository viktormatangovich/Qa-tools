import { Tabs } from '@base-ui-components/react/tabs'

interface TabButtonProps {
  value: string
  active: boolean
  children: React.ReactNode
}

export function TabButton({ value, active, children }: TabButtonProps) {
  return (
    <Tabs.Tab
      value={value}
      // Labels never wrap. Inside an `@container` tab list the padding and the
      // font shrink with the list width; past that the list scrolls.
      className={`shrink-0 inline-flex items-center whitespace-nowrap px-4 py-2 text-xs font-medium transition-colors @max-[600px]:px-2.5 @max-[480px]:px-1.5 @max-[480px]:text-[11px] @max-[400px]:px-1 @max-[400px]:text-[10px] ${
        active
          ? 'text-accent border-b-2 border-accent'
          : 'text-text-muted hover:text-text'
      }`}
    >
      {children}
    </Tabs.Tab>
  )
}
