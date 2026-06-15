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
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border px-6 py-3">
        <h1 className="text-lg font-bold text-foreground">✏️ 写邮件</h1>
      </header>
      <div className="max-w-3xl px-6 py-6">
        <ComposeMail
          to={replyTo}
          subject={replySubject.startsWith('Re:') ? replySubject : (replySubject ? `Re: ${replySubject}` : '')}
          replyToMessageId={replyMessageId}
          originalBody={originalBody}
          todoContext={todoContext}
          onDone={() => router.push('/mails')}
          onCancel={() => router.back()}
        />
      </div>
    </div>
  )
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-muted-foreground">加载中...</div>}>
      <ComposeContent />
    </Suspense>
  )
}
