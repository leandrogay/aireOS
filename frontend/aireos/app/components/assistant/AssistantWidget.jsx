'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertCircle, Maximize2, MessageCircle, Minimize2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { DIALOG_BACKDROP_CLASS } from '@/components/ui/dialog';
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
import { MOTION_EASE, SPRINGS } from '@/app/config/transitions';
import { modelNotice } from '@/app/utils/aiModels';
import useAiModelStatus from '@/hooks/useAiModelStatus';
import useAssistant, { ALL_CUSTOMERS } from '@/hooks/useAssistant';
import useCustomerOptions from '@/hooks/useCustomerOptions';
import AssistantMessage from './AssistantMessage';
import AssistantUnavailable from './AssistantUnavailable';
// The words shown while the assistant works ("Pondering…"); edit the list there.
import THINKING_WORDS from './thinkingWords';

// The shared Button's default (deep blue, opaque lighter hover) already is the
// brand primary; kept as a name for the Ask button and the launcher.
const primaryButtonClass = 'bg-deep-violet-blue text-white';
// Outline chips with the shared 3:1 boundary (deep blue at 60%).
const chipButtonClass = 'rounded-full border-deep-violet-blue/60 bg-white text-[11px] font-normal text-deep-violet-blue hover:bg-lavander';
// On the deep-blue header: white/80 is 6.8:1 there, white 9.6:1. The focus ring
// is white too, since the shared deep-blue one would vanish on the header.
const headerButtonClass = 'text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white';
// The launcher: the brand fill with the glass rim's lit top edge and the glass
// lift, so it floats like the panel it opens. Button brings press and focus-ring.
// motion-materialise (globals.css): it fades and scales up from its corner
// when it appears (page load, and coming back after full screen). CSS, so its
// click handler and the /login early return are untouched.
const launcherClass =
  'motion-materialise fixed bottom-4 right-4 z-50 size-12 rounded-full inset-shadow-[0_1px_0_rgb(255_255_255/0.25)] shadow-glass-2 [--transform-origin:bottom_right]';

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

// Opening the assistant pops the panel out of the chat button's corner on the
// shared dialog spring (SPRINGS.dialog); closing shrinks it back there,
// quicker, on the exit ease, before it unmounts (AnimatePresence). The exit
// stays at 0.15s, not the dialog exit: the leaving panel still covers the
// page, so a longer exit would hold clicks off it for longer. Only transform
// and opacity move, so the panel's size transition (full screen) is untouched.
const PANEL_POP = {
  closed: { opacity: 0, scale: 0.9, y: 16, transition: { duration: 0.15, ease: MOTION_EASE.exit } },
  open: { opacity: 1, scale: 1, y: 0, transition: SPRINGS.dialog },
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

// "What's changed?" for every customer or one: an "All customers" chip, then
// one per customer with sales (backend get_customer_options, the dashboard's
// own list), so a newly loaded customer gets a chip without a code change.
// The list is read by AssistantWidget before the panel opens, so the chips are
// there the moment it does.
function DigestChips({ options, onAsk, loading }) {
  const choices = [{ value: ALL_CUSTOMERS, label: 'All customers' }, ...options];

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-deep-violet-blue">What&apos;s changed?</p>
      <div className="flex flex-wrap gap-1">
        {choices.map((choice) => (
          <Button
            key={choice.value}
            variant="outline"
            size="xs"
            onClick={() => onAsk({ customer: choice.value, label: choice.label })}
            disabled={loading}
            className={chipButtonClass}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// The question box.
function QuestionForm({ onAsk, loading, unavailable }) {
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
        placeholder={unavailable ? 'The Assistant is unavailable' : 'Ask a business question...'}
        disabled={loading || unavailable}
        aria-label="Business question"
        className="text-xs text-deep-violet-blue md:text-xs"
      />
      <Button type="submit" size="sm" disabled={loading || unavailable || !draft.trim()} className={primaryButtonClass}>
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
  const [timesOpened, setTimesOpened] = useState(0);
  const { messages, askQuestion, askDigest, loading, error } = useAssistant();
  // Read on page load, not on opening, so the digest chips never pop in late.
  // Each opening re-reads it quietly, for a customer loaded since then.
  const { options: customerOptions } = useCustomerOptions({
    dataVersion: timesOpened,
    enabled: pathname !== '/login',
  });
  const reduceMotion = useReducedMotion();
  // Read again on each opening and after each failed question, so a question
  // that just found the model retired turns the panel into its unavailable state.
  const { data: modelStatus } = useAiModelStatus({
    refreshKey: `${timesOpened}|${error || ''}`,
    enabled: pathname !== '/login',
  });
  const unavailable = modelNotice(modelStatus, 'assistant');

  function toggleOpen() {
    if (!open) {
      setAnimateFrom(messages.length);
      setTimesOpened(timesOpened + 1);
    }
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
        {open && expanded && (
          <motion.div
            key="assistant-backdrop"
            aria-hidden="true"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.1 }}
            onClick={() => setExpanded(false)}
            className={DIALOG_BACKDROP_CLASS}
          />
        )}
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
              // A glass-3 window. The Card underneath is an aire-card, and the
              // glass rules come after it in globals.css, so glass-3 replaces its
              // white fill, border and shadow rather than stacking on them.
              // Nothing inside has a backdrop-filter of its own.
              'glass-3 fixed z-50 gap-0 rounded-glass-lg py-0',
              // Placed by its four edges (not width/height) so the move between the
              // two sizes can be animated; 100% is the window, scrollbar excluded.
              'transition-[top,left,right,bottom] duration-300 ease-out motion-reduce:transition-none',
              // Full screen is centred and exactly as wide as the messages inside it
              // (max-w-3xl, 48rem on MessageScrollerContent), over the blurred page.
              expanded
                ? 'top-4 right-[max(1rem,calc(50%-24rem))] bottom-4 left-[max(1rem,calc(50%-24rem))]'
                : 'top-[max(1rem,calc(100%-5rem-480px))] right-4 bottom-20 left-[max(1rem,calc(100%-1rem-360px))]',
            )}
          >
            {/* The header stays solid deep blue (white text 9.6:1): it names the
                window at a glance over any page, which a glass header would not. */}
            <CardHeader className="flex items-center justify-between rounded-t-none bg-deep-violet-blue py-2">
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

            {unavailable && <AssistantUnavailable title={unavailable.text} message={unavailable.detail} />}

            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <FollowNewQuestions messages={messages} />
              {/* Near solid for reading: white/70 over the 92% glass leaves about
                  2% of the page showing through, so long answers sit on white. */}
              <CardContent className="min-h-0 flex-1 overflow-hidden bg-white/70 px-0">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 p-3">
                      {messages.length === 0 && (
                        <MessageScrollerItem className="space-y-2">
                          <p className="text-xs text-ink-soft">
                            Ask a plain-English question about your sales or inventory data
                          </p>
                          <DigestChips options={customerOptions} onAsk={askDigest} loading={loading || Boolean(unavailable)} />
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
                      {/* The unavailable banner already says it: one problem, one message. */}
                      {error && !unavailable && (
                        <MessageScrollerItem>
                          <div
                            role="alert"
                            className="flex items-start gap-2 rounded-glass-sm border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800"
                          >
                            <AlertCircle aria-hidden="true" className="mt-px size-4 shrink-0 text-red-600" />
                            <span>{error}</span>
                          </div>
                        </MessageScrollerItem>
                      )}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton className="border-lavander text-deep-violet-blue" />
                </MessageScroller>
              </CardContent>

              <CardFooter className="border-(--glass-border) bg-white/70 p-2">
                <QuestionForm onAsk={askQuestion} loading={loading} unavailable={Boolean(unavailable)} />
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
        className={cn(launcherClass, primaryButtonClass)}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <MessageCircle aria-hidden="true" className="size-5" />}
      </Button>
    </>
  );
}
