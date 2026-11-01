'use client';

import { useContext } from 'react';
import { UploadContext } from '@/components/upload/UploadProvider';

/**
 * The upload list and its actions, kept by UploadProvider in the root layout
 * so uploads carry on while people use other pages.
 */
export default function useUploads() {
  return useContext(UploadContext);
}
