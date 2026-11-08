import { animate } from 'motion/react';

import { CARD_SELECTOR } from '@/app/config/transitions';

/**
 * Springs the cards inside `container` in one after another (see
 * app/config/transitions.js for what a card is and the timing). DOM-based on
 * purpose: cards are plain divs written in dozens of components, so finding
 * them by the shared card classes keeps every card animating without each
 * one opting in.
 *
 * Pages render skeleton cards first and swap in the real ones when their data
 * lands, so for `options.watchFor` seconds new cards are caught too: one that
 * mounts mid-cascade takes its place in the order instead of popping in ahead
 * of the cards above it. A container with no visible card springs in itself.
 *
 * Call it before paint (useLayoutEffect) so nothing shows at rest first.
 * Returns a cleanup that finishes every animation and stops watching.
 *
 * @param {HTMLElement} container
 * @param {{ y: number, stagger: number, maxStaggered: number, watchFor: number, transition: object }} options
 * @returns {() => void}
 */
export function cascadeCards(container, options) {
  const startedAt = performance.now();
  const sprung = new WeakSet();
  const running = [];
  let frame = null;

  function springIn(element, delay) {
    sprung.add(element);
    // Hidden straight away, so it doesn't show at rest while it waits its turn.
    element.style.opacity = '0';
    element.style.transform = `translateY(${options.y}px)`;
    const animation = animate(
      element,
      { opacity: [0, 1], y: [options.y, 0] },
      { ...options.transition, delay },
    );
    animation.then(() => clearInlineStyles(element));
    running.push({ element, animation });
  }

  function springInNewCards() {
    frame = null;
    const elapsed = (performance.now() - startedAt) / 1000;
    let slot = 0;
    for (const card of visibleOutermostCards(container)) {
      const delay = Math.max(0, Math.min(slot, options.maxStaggered) * options.stagger - elapsed);
      slot += 1;
      if (!sprung.has(card)) springIn(card, delay);
    }
    return slot;
  }

  const cardCount = springInNewCards();
  if (cardCount === 0) {
    springIn(container, 0);
    return () => finish(running);
  }

  // Batched to one pass per frame: a chart mounting adds hundreds of nodes.
  const observer = new MutationObserver(() => {
    if (frame === null) frame = requestAnimationFrame(springInNewCards);
  });
  observer.observe(container, { childList: true, subtree: true });
  const stopWatching = setTimeout(() => observer.disconnect(), options.watchFor * 1000);

  return () => {
    clearTimeout(stopWatching);
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    finish(running);
  };
}

// Cards in document order (top to bottom, left to right in a grid), skipping
// hidden ones (an inactive tab) and any card nested inside another card.
function visibleOutermostCards(container) {
  return [...container.querySelectorAll(CARD_SELECTOR)].filter((card) => {
    const outer = card.parentElement?.closest(CARD_SELECTOR);
    if (outer && container.contains(outer)) return false;
    return card.getClientRects().length > 0;
  });
}

// Jump every animation to its end and hand the cards back their own styles.
function finish(running) {
  for (const { element, animation } of running) {
    animation.complete();
    clearInlineStyles(element);
  }
}

// The animation leaves inline opacity/transform behind; drop them so a card's
// own classes (hover lifts, transitions) apply again.
function clearInlineStyles(element) {
  element.style.removeProperty('opacity');
  element.style.removeProperty('transform');
}
