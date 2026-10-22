// The editor applies its document to one selected text layer or to grouped
// title/body layers inside the selected Description body area.
export type SelectionWrite =
  | { kind: 'text'; name: string }
  | { kind: 'description' };
