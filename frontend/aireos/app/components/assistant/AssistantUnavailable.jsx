import { AlertCircle } from 'lucide-react';

/**
 * The one message the Assistant shows while its model is gone (backend
 * ai_models): a blocking error, so it is red (an error, not a warning) and
 * stays until the setting is changed, and the question box is disabled
 * beneath it. The failed question's own error is not shown as well -- one
 * problem, one message.
 *
 * @param {{ title: string, message: string | null }} props
 */
export default function AssistantUnavailable({ title, message }) {
  return (
    <div role="status" className="flex items-start gap-2.5 border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
      <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-red-600" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] leading-4 font-medium">{title}</p>
        {message && <p className="leading-relaxed text-red-800/85">{message}</p>}
      </div>
    </div>
  );
}
