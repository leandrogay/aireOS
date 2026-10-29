'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Maximize2, MessageCircle, Minimize2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller';
import { cn } from '@/lib/utils';
import useAssistant from '@/hooks/useAssistant';
import AssistantMessage from './AssistantMessage';
// The words shown while the assistant works ("Pondering…"); edit the list there.
import THINKING_WORDS from './thinkingWords';

// Brand colours instead of the shadcn default (near-black `primary`), as the
// other pages override the shared Button.
const primaryButtonClass = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90';
const chipButtonClass = 'rounded-full border-violet bg-white text-[11px] font-normal text-deep-violet-blue hover:bg-lavander';
const headerButtonClass = 'text-white/70 hover:bg-white/10 hover:text-white';

// shadcn's "Spring Bounce" message preset (lib/message-animations.ts on the
// shadcn docs site): a message rises 12px and grows from 96% with a quick
// spring that overshoots slightly as it settles. Only transform and opacity
// move, so the scroller's measurements and anchoring stay put.
const SPRING_BOUNCE = {
  initial: { opacity: 0, y: 12, scale: 0.96 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 },
  },
};

const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

// Opening the assistant pops the panel out of the chat button's corner with
// the same kind of spring as SPRING_BOUNCE; closing shrinks it back there,
// quicker, before it unmounts (AnimatePresence). Only transform and opacity
// move, so the panel's size transition (full screen) is untouched.
const PANEL_POP = {
  closed: { opacity: 0, scale: 0.9, y: 16, transition: { duration: 0.15, ease: 'easeIn' } },
  open: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 32 } },
};

const MotionCard = motion.create(Card);

// Claude Code's spinner: a star that grows through these glyphs and shrinks
// back (ping-pong), one frame every SPINNER_FRAME_MS.
const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPINNER_FRAMES = [...SPINNER_GLYPHS, ...SPINNER_GLYPHS.slice(1, -1).reverse()];
const SPINNER_FRAME_MS = 120;

// How often the thinking word changes during a long wait.
const WORD_ROTATE_MS = 3000;

// A random thinking word, never `current` again, so a change is always visible.
function randomThinkingWord(current) {
  const choices = THINKING_WORDS.filter((word) => word !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? current ?? 'Thinking';
}

// "✻ Pondering…" while an answer is on its way: the spinner above, and a
// highlight sweeping across the word (.thinking-shimmer, globals.css). It
// mounts each time the assistant starts working, so every wait starts on a
// fresh random word, which then changes to another every WORD_ROTATE_MS until
// the answer arrives (picked in timers, never during a render). Reduced
// motion: a still star and plain text; the word still changes, which is not
// motion.
function ThinkingIndicator() {
  const [word, setWord] = useState(() => randomThinkingWord(null));
  const [frame, setFrame] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => setFrame((current) => (current + 1) % SPINNER_FRAMES.length), SPINNER_FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  useEffect(() => {
    const timer = setInterval(() => setWord((current) => randomThinkingWord(current)), WORD_ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <p role="status" className="flex items-center gap-1.5 text-xs">
      {/* Fixed width: the glyphs differ in width, so the word would jitter. */}
      <span aria-hidden="true" className="inline-block w-3 text-center text-deep-violet-blue">
        {reduceMotion ? '✻' : SPINNER_FRAMES[frame]}
      </span>
      <span className="thinking-shimmer">{word}…</span>
    </p>
  );
}

// Jumps the transcript to the bottom whenever a new message of yours appears
// -- typed, a follow-up chip or "What's changed?" -- even if you had scrolled
// up to an older answer. Once there, autoScroll keeps following, so the answer
// is followed in as it draws (a table's rows grow it). Renders nothing; lives
// inside MessageScrollerProvider for useMessageScroller. Starts from the
// messages already there, so reopening the panel doesn't count as new.
function FollowNewQuestions({ messages }) {
  const { scrollToEnd } = useMessageScroller();
  const seen = useRef(messages.length);

  useEffect(() => {
    const isNewQuestion = messages.length > seen.current && messages[messages.length - 1].role === 'user';
    seen.current = messages.length;
    if (isNewQuestion) scrollToEnd();
  }, [messages, scrollToEnd]);

  return null;
}

// The question box.
function QuestionForm({ onAsk, loading }) {
  const [draft, setDraft] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || loading) return;
    setDraft('');
    onAsk(question);
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl items-center gap-2">
      <Input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask a business question..."
        disabled={loading}
        aria-label="Business question"
        className="border-violet text-xs text-deep-violet-blue md:text-xs"
      />
      <Button type="submit" size="sm" disabled={loading || !draft.trim()} className={primaryButtonClass}>
        Ask
      </Button>
    </form>
  );
}

// Floating chat widget, mounted once in app/layout.js (a real Next.js
// layout, unlike AppShell -- see the plan this was built from) so its
// conversation state survives client-side navigation between pages instead
// of resetting on every route change.
//
// The transcript is a shadcn MessageScroller: it opens at the bottom, stays
// pinned there as questions and answers arrive (autoScroll; it lets go once you
// scroll up, and a "scroll to end" button brings you back). No message is a
// scroll anchor: an anchor would hold each question at the top and leave its
// answer's chart, table and follow-ups below the fold. Messages have no ids,
// so the list index is their key and messageId; turns are only ever appended.
//
// New questions and answers bounce in (SPRING_BOUNCE). The panel unmounts when
// closed, so `animateFrom` is the message count when it was last opened: only
// messages that arrive while it is open animate, not the whole history on
// every reopen. Reduced motion: no entrance. The same rule decides whether an
// answer's chart draws in and its table rows fade in (AssistantMessage `animate`).
//
// Full screen, like the chat on the client's own site (shop-aire.com): the
// header's maximise button grows the panel to fill the window beside the nav
// bar, with the conversation and question box in a centred column, and Escape or the same
// button shrinks it back. It grows from its corner (width/height/bottom
// transition), and stays full screen across close and reopen.
export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [animateFrom, setAnimateFrom] = useState(0);
  const { messages, askQuestion, askDigest, loading, error } = useAssistant();
  const reduceMotion = useReducedMotion();

  function toggleOpen() {
    if (!open) setAnimateFrom(messages.length);
    setOpen(!open);
  }

  useEffect(() => {
    if (!open || !expanded) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setExpanded(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, expanded]);

  if (pathname === '/login') return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <MotionCard
            key="assistant-panel"
            size="sm"
            variants={PANEL_POP}
            initial={reduceMotion ? false : 'closed'}
            animate="open"
            exit={reduceMotion ? undefined : 'closed'}
            style={{ transformOrigin: 'bottom right' }}
            className={cn(
              'fixed z-50 gap-0 bg-white py-0 ring-0',
              // Placed by its four edges (not width/height) so the move between the
              // two sizes can be animated; 100% is the window, scrollbar excluded.
              'transition-[top,left,right,bottom] duration-300 ease-out motion-reduce:transition-none',
              // Full screen covers the page edge to edge beside the nav bar, open or
              // collapsed (--sidebar-width, set by Sidebar), so you can still move
              // between pages. A page with no nav bar is covered completely.
              expanded
                ? 'top-0 right-0 bottom-0 left-[var(--sidebar-width,0px)] rounded-none border-0 shadow-none'
                : 'top-[max(1rem,calc(100%-5rem-480px))] right-4 bottom-20 left-[max(1rem,calc(100%-1rem-360px))] rounded-lg border border-lavander shadow-xl',
            )}
          >
            <CardHeader className="flex items-center justify-between bg-deep-violet-blue py-2">
              <CardTitle className="font-sans text-sm text-white">Ask AireOS</CardTitle>
              <div className="-mr-1 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setExpanded(!expanded)}
                  aria-label={expanded ? 'Exit full screen' : 'Full screen'}
                  aria-pressed={expanded}
                  className={headerButtonClass}
                >
                  {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setOpen(false)}
                  aria-label="Close assistant"
                  className={headerButtonClass}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>

            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <FollowNewQuestions messages={messages} />
              <CardContent className="min-h-0 flex-1 overflow-hidden px-0">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 p-3">
                      {messages.length === 0 && (
                        <MessageScrollerItem className="space-y-2">
                          <p className="text-xs text-deep-violet-blue/60">
                            Ask a plain-English question about your sales or inventory data, e.g. &quot;How did
                            revenue do last week?&quot; or &quot;What SKUs are at risk right now?&quot;
                          </p>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={askDigest}
                            disabled={loading}
                            className={chipButtonClass}
                          >
                            What&apos;s changed?
                          </Button>
                        </MessageScrollerItem>
                      )}
                      {messages.map((message, i) => (
                        <MotionMessageScrollerItem
                          key={i}
                          messageId={String(i)}
                          variants={SPRING_BOUNCE}
                          initial={reduceMotion || i < animateFrom ? false : 'initial'}
                          animate="animate"
                        >
                          <AssistantMessage
                            message={message}
                            onFollowUp={askQuestion}
                            animate={!reduceMotion && i >= animateFrom}
                            expanded={expanded}
                          />
                        </MotionMessageScrollerItem>
                      ))}
                      {loading && (
                        <MessageScrollerItem>
                          <ThinkingIndicator />
                        </MessageScrollerItem>
                      )}
                      {error && (
                        <MessageScrollerItem>
                          <p role="alert" className="text-xs text-red-600">
                            {error}
                          </p>
                        </MessageScrollerItem>
                      )}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton className="border-lavander text-deep-violet-blue" />
                </MessageScroller>
              </CardContent>

              <CardFooter className="border-lavander bg-white p-2">
                <QuestionForm onAsk={askQuestion} loading={loading} />
              </CardFooter>
            </MessageScrollerProvider>
          </MotionCard>
        )}
      </AnimatePresence>

      {/* Hidden in full screen, where the panel covers its corner; the header closes it. */}
      <Button
        onClick={toggleOpen}
        hidden={open && expanded}
        aria-label={open ? 'Close AireOS assistant' : 'Open AireOS assistant'}
        className={`fixed bottom-4 right-4 z-50 size-12 rounded-full shadow-lg ${primaryButtonClass}`}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <MessageCircle aria-hidden="true" className="size-5" />}
      </Button>
    </>
  );
}
