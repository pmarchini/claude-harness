import type { Loop, RepeatGroup, Step } from './loop-rules.ts';

const BOX_WIDTH = 15;
const BOX_HEIGHT = 4;
const ARROW_LENGTH = 4;
/** Space between a repeat frame's wall and the boxes inside it. */
const FRAME_PADDING = 3;

type PlacedBox = { step: Step; x: number };
type PlacedFrame = { repeat: RepeatGroup; left: number; right: number; boxes: PlacedBox[] };

/** Steps to draw with a heavy border, by position in drawing order (the editor's cursor). */
export type RenderOptions = { selected?: number[] };

/**
 * Draws a loop as an ASCII graph: steps are boxes joined left to right, and each
 * repeat group is a double-lined frame with an edge looping back from its last
 * step to its first.
 */
export function renderLoop(loop: Loop, { selected = [] }: RenderOptions = {}): string {
  const { boxes, frames, width } = layOut(loop);
  const hasFrames = frames.length > 0;
  const boxTop = hasFrames ? 2 : 0;
  const height = hasFrames ? boxTop + BOX_HEIGHT + 3 : BOX_HEIGHT;
  const canvas = new Canvas(width, height);

  for (const frame of frames) drawFrame(canvas, frame, height);
  boxes.forEach((box, position) => drawBox(canvas, box, boxTop, selected.includes(position)));
  drawArrows(canvas, boxes, boxTop + 1);
  for (const frame of frames) drawLoopBack(canvas, frame, boxTop + BOX_HEIGHT, height - 2);

  return canvas.toString();
}

/** Decides where every box and frame goes, left to right. */
function layOut(loop: Loop) {
  const boxes: PlacedBox[] = [];
  const frames: PlacedFrame[] = [];
  let x = 0;

  for (const node of loop.steps) {
    if (!('repeat' in node)) {
      boxes.push({ step: node, x });
      x += BOX_WIDTH + ARROW_LENGTH;
      continue;
    }

    const left = x;
    x += 1 + FRAME_PADDING;
    const inside = node.repeat.steps.map((step, i) => ({
      step,
      x: x + i * (BOX_WIDTH + ARROW_LENGTH),
    }));
    // A valid repeat has at least one step.
    const contentRight = inside.at(-1)!.x + BOX_WIDTH + FRAME_PADDING;
    const right = Math.max(contentRight, left + frameLabel(node.repeat).length + 4);

    boxes.push(...inside);
    frames.push({ repeat: node.repeat, left, right, boxes: inside });
    x = right + 1 + ARROW_LENGTH;
  }

  return { boxes, frames, width: x - ARROW_LENGTH };
}

function frameLabel(repeat: RepeatGroup): string {
  return ` repeat until: ${repeat.until.join(', ')} pass · max ${repeat.max_rounds} rounds `;
}

function drawFrame(canvas: Canvas, { repeat, left, right }: PlacedFrame, height: number) {
  const inner = right - left - 1;
  canvas.write(left, 0, `╔${'═'.repeat(inner)}╗`);
  canvas.write(left + 1, 0, `═${frameLabel(repeat)}`);
  canvas.write(left, height - 1, `╚${'═'.repeat(inner)}╝`);
  for (let y = 1; y < height - 1; y++) {
    canvas.write(left, y, '║');
    canvas.write(right, y, '║');
  }
}

type Edge = readonly [left: string, fill: string, right: string];
const LIGHT = { top: ['┌', '─', '┐'] as Edge, side: '│', bottom: ['└', '─', '┘'] as Edge };
const HEAVY = { top: ['┏', '━', '┓'] as Edge, side: '┃', bottom: ['┗', '━', '┛'] as Edge };

function drawBox(canvas: Canvas, { step, x }: PlacedBox, top: number, isSelected: boolean) {
  const inner = BOX_WIDTH - 2;
  const detail = step.run ?? `@${step.agent}`;
  const line = isSelected ? HEAVY : LIGHT;
  const edge = ([left, fill, right]: Edge) => `${left}${fill.repeat(inner)}${right}`;
  canvas.write(x, top, edge(line.top));
  canvas.write(x, top + 1, `${line.side} ${fit(step.id, inner - 2)} ${line.side}`);
  canvas.write(x, top + 2, `${line.side} ${fit(detail, inner - 2)} ${line.side}`);
  canvas.write(x, top + 3, edge(line.bottom));
}

/** Joins consecutive boxes; frame walls the arrow crosses stay visible. */
function drawArrows(canvas: Canvas, boxes: PlacedBox[], y: number) {
  for (let i = 1; i < boxes.length; i++) {
    const from = boxes[i - 1]!.x + BOX_WIDTH;
    const to = boxes[i]!.x - 1;
    for (let x = from; x < to; x++) canvas.writeIfEmpty(x, y, '─');
    canvas.write(to, y, '>');
  }
}

function drawLoopBack(canvas: Canvas, { boxes }: PlacedFrame, firstRow: number, edgeRow: number) {
  const start = boxes[0]!.x + 4;
  const end = boxes.at(-1)!.x + BOX_WIDTH - 5;
  for (let y = firstRow; y < edgeRow; y++) {
    canvas.write(start, y, y === firstRow ? '^' : '│');
    canvas.write(end, y, '│');
  }
  canvas.write(start, edgeRow, `└${'─'.repeat(end - start - 1)}┘`);

  const label = ' no: next round ';
  if (end - start > label.length + 4) {
    canvas.write(start + Math.floor((end - start - label.length) / 2), edgeRow, label);
  }
}

function fit(text: string, width: number): string {
  return text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 1)}…`;
}

class Canvas {
  private readonly rows: string[][];

  constructor(width: number, height: number) {
    this.rows = Array.from({ length: height }, () => Array<string>(width).fill(' '));
  }

  write(x: number, y: number, text: string) {
    const row = this.rows[y]!;
    [...text].forEach((char, i) => (row[x + i] = char));
  }

  writeIfEmpty(x: number, y: number, char: string) {
    const row = this.rows[y]!;
    if (row[x] === ' ') row[x] = char;
  }

  toString(): string {
    return this.rows.map((row) => row.join('').trimEnd()).join('\n');
  }
}
