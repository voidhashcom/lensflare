import { SearchIcon } from "lucide-react";

import { Kbd } from "~/components/ui/kbd";

/**
 * Search input row shown in the sidebar header. Currently a visual-only
 * placeholder — wiring the input to a search store is tracked separately.
 */
export component SearchRow() {
  <div class="desktop-no-drag relative flex h-8 items-center rounded-lg bg-accent/40 pl-2.5 pr-2 ring-ring/24 transition-shadow has-focus-visible:ring-[3px]">
    <SearchIcon class="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
    <input
      aria-label="Search projects and datasets"
      class="h-full min-w-0 flex-1 bg-transparent px-2 text-sm leading-8 outline-none placeholder:text-muted-foreground/72"
      placeholder="Search"
      type="search"
    />
    <Kbd>{"\u2318K"}</Kbd>
  </div>
}
