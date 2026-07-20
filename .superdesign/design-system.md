# Desktop Record Pet — design system

Preserve the existing semantic CSS-token architecture and all five selectable themes. Do not hardcode Midnight Amber colors in feature components. The note editor should feel like a calm desktop writing environment: strong information hierarchy, a persistent but light document header, clearly grouped mode controls, and editing controls visible without competing with the writing canvas.

Use semantic Tailwind classes (`bg-surface`, `text-text`, `text-text-muted`, `border-border`, `bg-primary/*`, `bg-secondary/*`) rather than absolute colors. Keep dense desktop affordances: 11–13px metadata, 14px body controls, rounded 6–12px utility surfaces, and 16–24px content insets. Maintain keyboard-first save/cancel behavior and light/dark plus all custom theme compatibility.
