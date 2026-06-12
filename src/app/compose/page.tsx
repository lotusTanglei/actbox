// src/app/compose/page.tsx

'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ComposeMail } from '@/components/ComposeMail'

function ComposeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const replyTo = searchParams.get('to') || ''
  const replySubject = searchParams.get('subject') || ''
  const replyMessageId = searchParams.get('messageId') || undefined
  const originalBody = searchParams.get('originalBody') || undefined
  const todoContext = searchParams.get('todoContext') || undefined

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-20">
      <ComposeMail
        to={replyTo}
        subject={replySubject.startsWith('Re:') ? replySubject : (replySubject ? `Re: ${replySubject}` : '')}
        replyToMessageId={replyMessageId}
        originalBody={originalBody}
        todoContext={todoContext}
        onDone={() => router.push('/mails')}
        onCancel={() => router.back()}
      />
    </main>
  )
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-muted-foreground">加载中...</div>}>
      <ComposeContent />
    </Suspense>
  )
}
