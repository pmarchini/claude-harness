// The values the loops mod keeps in $.state, and their shapes.

/** A step of a loop: a shell command to run, or an agent to ask. */
export type EditorStep = { id: string; run?: string; agent?: string };
export type EditorNode =
  | EditorStep
  | { repeat: { id: string; until: string[]; max_rounds: number; steps: EditorStep[] } };

/** The loop being built in the `/loops new` pane. */
export type EditorState = {
  stage: 'start' | 'edit' | 'saved';
  loop: { name: string; steps: EditorNode[] };
  /** The step the next edit acts on, in drawing order; -1 before the first. */
  cursor: number;
  /** The list open under the graph: blocks to add, or steps to wrap in a repeat. */
  picker?: 'block' | 'range';
  commands: { tests: string; lint: string };
  /** A line telling the person what just happened or what is wrong. */
  message?: string;
};

declare module 'claude-code' {
  interface PluginState {
    loops: { editor: Shaped<EditorState> };
  }
}
