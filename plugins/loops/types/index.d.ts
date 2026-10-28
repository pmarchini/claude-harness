// The values the loops mod keeps in $.state, and their shapes.

/** A step of a loop: a shell command to run, or an agent to ask. */
export type EditorStep = { id: string; run?: string; agent?: string };
export type EditorNode =
  | EditorStep
  | { repeat: { id: string; until: string[]; max_rounds: number; steps: EditorStep[] } };

/** The loop being built in the `/loop-manager new` pane. */
export type EditorState = {
  /** Name it, pick how to start, build the graph, saved. */
  stage: 'name' | 'start' | 'edit' | 'saved';
  loop: { name: string; steps: EditorNode[] };
  /** The step the next edit acts on, in drawing order; -1 before the first. */
  cursor: number;
  /** The list shown in place of the actions: blocks to add, steps to repeat, or what a repeat waits on. */
  picker?: 'block' | 'range' | 'until';
  /** The field shown in place of the actions: the cursor's command, or its repeat's round limit. */
  editing?: 'command' | 'rounds';
  commands: { tests: string; lint: string };
  /** News of the last edit, for the line under the graph. */
  message?: string;
  /** What is wrong with the last thing tried, for the same line. */
  warning?: string;
};

declare module 'claude-code' {
  interface PluginState {
    loops: { editor: Shaped<EditorState> };
  }
}
