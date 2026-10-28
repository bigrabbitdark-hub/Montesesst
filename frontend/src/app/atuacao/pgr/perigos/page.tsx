'use client';

import { Suspense } from 'react';
import { PerigosView } from '../PerigosView';

export default function PerigosPage() {
  return (
    <Suspense fallback={null}>
      <PerigosView />
    </Suspense>
  );
}
