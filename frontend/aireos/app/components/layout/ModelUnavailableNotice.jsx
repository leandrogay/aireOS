'use client';

import { AlertTriangle } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import useAiModelStatus from '@/hooks/useAiModelStatus';
import { modelNotice } from '@/app/utils/aiModels';
import { cn } from '@/lib/utils';

/**
 * One amber line saying an AI feature's model is no longer available (backend
 * ai_models), shown from the first failed call until the setting names a
 * different model. Renders nothing while the model works, while the status
 * loads, or when it could not be read: this only adds to the error the
 * feature itself shows. Wording in utils/aiModels.js (modelNotice).
 *
 * @param {object} props
 * @param {'mapping' | 'assistant'} props.feature
 * @param {string} [props.className]
 */
export default function ModelUnavailableNotice({ feature, className }) {
  const { data } = useAiModelStatus();
  const notice = modelNotice(data, feature);
  if (!notice) return null;

  return (
    // Same amber box as the review page's "AI was unavailable" warning (ReviewHeader).
    <p
      role="status"
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900',
        className,
      )}
    >
      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-amber-700" />
      <span>{notice.text}</span>
      {notice.detail && (
        <InfoTooltip label="Which setting to change">{notice.detail}</InfoTooltip>
      )}
    </p>
  );
}
