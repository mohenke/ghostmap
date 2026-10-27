// drei's <Html> renders inside the canvas wrapper, so clicks on a card also reach
// the 3D scene (R3F listens natively on that wrapper) and would select whatever
// is behind the card. Use as a ref callback on the card's outermost element.
//
// Events are stopped on drei's Html container – the element placed beside the
// canvas, which is also the React root of the card – so the card's own React
// handlers still run before the event is stopped.
const EVENTS = ["pointerdown", "pointerup", "click", "dblclick"] as const;

export function keepEventsInCard(card: HTMLElement | null) {
  let node: HTMLElement | null = card;
  // climb to the element whose parent holds the <canvas> (directly or one level down)
  while (node?.parentElement && !node.parentElement.querySelector("canvas")) node = node.parentElement;
  const root = node as (HTMLElement & { __gpCard?: boolean }) | null;
  if (!root || !root.parentElement || root.__gpCard) return;
  root.__gpCard = true;
  for (const type of EVENTS) root.addEventListener(type, (e) => e.stopPropagation());
}
