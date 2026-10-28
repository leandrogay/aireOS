'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
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
} from '@/components/ui/message-scroller';
import useAssistant from '@/hooks/useAssistant';
import AssistantMessage from './AssistantMessage';

// Brand colours instead of the shadcn default (near-black `primary`), as the
// other pages override the shared Button.
const primaryButtonClass = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90';
const chipButtonClass = 'rounded-full border-violet bg-white text-[11px] font-normal text-deep-violet-blue hover:bg-lavander';

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

// Floating chat widget, mounted once in app/layout.js (a real Next.js
// layout, unlike AppShell -- see the plan this was built from) so its
// conversation state survives client-side navigation between pages instead
// of resetting on every route change.
//
// The transcript is a shadcn MessageScroller: it opens on the newest message,
// each question is a scroll anchor (asking scrolls it to the top so its answer
// reads from the start, charts and all), and a "scroll to end" button shows
// once you have scrolled up. Messages have no ids, so the list index is their
// key and messageId; turns are only ever appended.
//
// New questions and answers bounce in (SPRING_BOUNCE). The panel unmounts when
// closed, so `animateFrom` is the message count when it was last opened: only
// messages that arrive while it is open animate, not the whole history on
// every reopen. Reduced motion: no entrance.
export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [animateFrom, setAnimateFrom] = useState(0);
  const { messages, askQuestion, askDigest, loading, error } = useAssistant();
  const reduceMotion = useReducedMotion();

  function toggleOpen() {
    if (!open) setAnimateFrom(messages.length);
    setOpen(!open);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || loading) return;
    setDraft('');
    askQuestion(question);
  }

  if (pathname === '/login') return null;

  return (
    <>
      {open && (
        <Card
          size="sm"
          className="fixed bottom-20 right-4 z-50 h-[480px] w-[360px] max-w-[calc(100vw-2rem)] gap-0 rounded-lg border border-lavander bg-white py-0 shadow-xl ring-0"
        >
          <CardHeader className="flex items-center justify-between border-b border-lavander bg-cream py-2">
            <CardTitle className="font-sans text-sm text-deep-violet-blue">Ask AireOS</CardTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="-mr-1 text-deep-violet-blue/60 hover:bg-lavander hover:text-deep-violet-blue"
            >
              <X aria-hidden="true" />
            </Button>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-hidden px-0">
            <MessageScrollerProvider>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-3 p-3">
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
                        scrollAnchor={message.role === 'user'}
                        variants={SPRING_BOUNCE}
                        initial={reduceMotion || i < animateFrom ? false : 'initial'}
                        animate="animate"
                      >
                        <AssistantMessage message={message} onFollowUp={askQuestion} />
                      </MotionMessageScrollerItem>
                    ))}
                    {loading && (
                      <MessageScrollerItem>
                        <p role="status" className="text-xs text-deep-violet-blue/60">
                          Thinking…
                        </p>
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
            </MessageScrollerProvider>
          </CardContent>

          <CardFooter className="border-lavander bg-white p-2">
            <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
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
          </CardFooter>
        </Card>
      )}

      <Button
        onClick={toggleOpen}
        aria-label={open ? 'Close AireOS assistant' : 'Open AireOS assistant'}
        className={`fixed bottom-4 right-4 z-50 size-12 rounded-full shadow-lg ${primaryButtonClass}`}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <MessageCircle aria-hidden="true" className="size-5" />}
      </Button>
    </>
  );
}
