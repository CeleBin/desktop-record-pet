# Theme

The app uses Tailwind CSS v4 with CSS variables from `src/styles.css`. Theme is set on `<html data-theme data-mode>` by `src/lib/theme.ts` and supports five visual families with light/dark modes.

Core semantic tokens: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--primary`, `--secondary`, `--accent`, `--danger`, `--text`, `--text-strong`, `--text-muted`, `--border`, `--radius-shape`, `--font-display`, `--font-body`.

Default theme: Midnight Amber / dark. Its values are `#060b18` bg, `#0e1525` surface, `#f0b84d` primary, `#4a9a8a` secondary, `#d6dce5` text, 4px shape radius, JetBrains Mono display and IBM Plex Sans body.

Other themes: Sakura Mist (Playfair/Nunito), Matcha Morning (Fraunces/DM Sans), Lavender Dream (Cormorant/Quicksand), Sunset Warm (Archivo Black/Work Sans).

Tailwind bridge maps semantic values to classes such as `bg-bg`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`, and `bg-primary/10`.

BlockNote is styled through `.bn-root[data-color-scheme]`, aliasing its editor/menu/selection variables back to the semantic token system. Current editor padding is `16px 20px`.
